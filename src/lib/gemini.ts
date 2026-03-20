import path from "node:path";
import process from "node:process";

import { GoogleGenAI } from "@google/genai";

import {
  ALLOW_GEMINI_TEXT_JSON_FALLBACK,
  CACHE_CREATE_TIMEOUT_MS,
  DEFAULT_CACHE_TTL_SECONDS,
  FILE_PROCESSING_DEADLINE_MS,
  FILE_PROCESSING_POLL_INTERVAL_MS,
  FILE_UPLOAD_TIMEOUT_MS,
  GENERATION_TIMEOUT_MS,
  LOW_MEDIA_RESOLUTION,
  MODEL_INPUT_TOKEN_LIMITS,
  SYNTHESIS_TIMEOUT_MS,
  TOKEN_BUDGET_FPS_CANDIDATES,
  TOKEN_BUDGET_RATIO,
  TOKEN_COUNT_TIMEOUT_MS,
} from "./constants.js";
import { DiagnosticError, type ErrorStage, isAbortError, isRetryableError, isTimeoutError } from "./errors.js";
import { validateJsonObjectAgainstSchema } from "./json-schema.js";
import type { Logger } from "./logger.js";
import type {
  ChunkPlanItem,
  DownloadedVideo,
  JsonObject,
  TokenBudgetAttempt,
  TokenBudgetDecision,
  UploadedVideoHandle,
  VideoPartOptions,
  VideoSource,
  YtDlpMetadata,
} from "./types.js";

type GeminiCallContext = {
  logger: Logger;
  tool: string;
  stage: ErrorStage;
  code: string;
  failureMessage: string;
  strategyRequested?: string;
  strategyAttempted?: string;
  model?: string;
  inputMode?: string;
  responseMode?: "schema_json" | "text_plain_json";
  details?: Record<string, unknown>;
  maxAttempts?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

export type GenerationContext = {
  logger: Logger;
  tool: string;
  stage: ErrorStage;
  code: string;
  failureMessage: string;
  strategyRequested?: string;
  strategyAttempted?: string;
  inputMode?: string;
  responseMode?: "schema_json" | "text_plain_json";
  details?: Record<string, unknown>;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

type HttpConfig = {
  httpOptions?: { timeout?: number };
  abortSignal?: AbortSignal;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(signal.reason ? String(signal.reason) : "Request aborted.");
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error(signal.reason ? String(signal.reason) : "Request aborted."));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error(signal?.reason ? String(signal.reason) : "Request aborted."));
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createHttpConfig(timeoutMs: number | undefined, abortSignal: AbortSignal | undefined): HttpConfig {
  return {
    ...(timeoutMs ? { httpOptions: { timeout: timeoutMs } } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  };
}

function createTimedAbortController(timeoutMs: number | undefined, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = timeoutMs
    ? setTimeout(() => controller.abort(`Request timed out after ${timeoutMs}ms.`), timeoutMs)
    : undefined;

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason ? String(parentSignal.reason) : "Request aborted.");
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    parentSignal?.removeEventListener("abort", onParentAbort);
  };

  controller.signal.addEventListener("abort", cleanup, { once: true });

  return { signal: controller.signal, cleanup };
}

function createCancellationError(context: GeminiCallContext, error: unknown): DiagnosticError {
  return new DiagnosticError({
    tool: context.tool,
    code: "REQUEST_CANCELLED",
    stage: context.stage,
    message: "Request cancelled.",
    retryable: false,
    strategyRequested: context.strategyRequested,
    strategyAttempted: context.strategyAttempted,
    cause: error,
    details: {
      ...context.details,
      model: context.model,
      inputMode: context.inputMode,
      responseMode: context.responseMode,
      timeoutMs: context.timeoutMs,
      failureKind: "cancelled",
    },
  });
}

async function runGeminiCall<T>(operation: () => Promise<T>, context: GeminiCallContext): Promise<T> {
  const maxAttempts = context.maxAttempts ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(context.abortSignal);

    try {
      const result = await operation();
      if (attempt > 1) {
        context.logger.info("gemini.call_recovered", {
          stage: context.stage,
          code: context.code,
          attempt,
          maxAttempts,
          model: context.model,
          inputMode: context.inputMode,
          responseMode: context.responseMode,
        });
      }
      return result;
    } catch (error) {
      if (isAbortError(error) || context.abortSignal?.aborted) {
        throw createCancellationError(context, error);
      }

      const retryable = isRetryableError(error);
      const message = error instanceof Error ? error.message : String(error);
      const failureKind = isTimeoutError(error) ? "local_timeout" : "provider_error";

      context.logger.warn("gemini.call_failed", {
        stage: context.stage,
        code: context.code,
        attempt,
        maxAttempts,
        retryable,
        model: context.model,
        inputMode: context.inputMode,
        responseMode: context.responseMode,
        message,
        timeoutMs: context.timeoutMs,
        failureKind,
        ...context.details,
      });

      if (!retryable || attempt === maxAttempts) {
        throw new DiagnosticError({
          tool: context.tool,
          code: context.code,
          stage: context.stage,
          message: context.failureMessage,
          retryable,
          strategyRequested: context.strategyRequested,
          strategyAttempted: context.strategyAttempted,
          cause: error,
          details: {
            ...context.details,
            model: context.model,
            inputMode: context.inputMode,
            responseMode: context.responseMode,
            attempts: attempt,
            timeoutMs: context.timeoutMs,
            failureKind,
          },
        });
      }

      await sleep(attempt * 1000, context.abortSignal);
    }
  }

  throw new Error("unreachable");
}

export function createAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

  return new GoogleGenAI({ apiKey });
}

function getInputTokenLimit(model: string): number {
  return MODEL_INPUT_TOKEN_LIMITS[model] ?? 1_048_576;
}

function toDurationString(seconds: number): string {
  return `${seconds}s`;
}

function buildLanguageInstruction(): string {
  return [
    "Identify the dominant spoken or on-screen language used in the video content.",
    'Populate `detectedLanguage` with that language, preferably as a BCP-47 tag such as `en`, `pt-BR`, or `ja`. Use `und` only if you genuinely cannot infer the language.',
    "Write every natural-language field value in that detected language.",
    "Keep the JSON structure and property names exactly as required by the schema.",
  ].join(" ");
}

export function buildPrompt(
  analysisPrompt?: string,
  startOffsetSeconds?: number,
  endOffsetSeconds?: number
): string {
  const basePrompt =
    "Analyze the attached public YouTube video and return valid JSON only. Focus on factual observations from the video itself. Summarize the content, list the main topics, identify key moments with timestamps when possible, capture notable quotes carefully, extract any clear action items, and mention safety, uncertainty, or accuracy caveats if relevant.";
  const clipScopePrompt =
    startOffsetSeconds !== undefined || endOffsetSeconds !== undefined
      ? `Analyze only the selected clip window from ${startOffsetSeconds ?? 0}s to ${
          endOffsetSeconds !== undefined ? `${endOffsetSeconds}s` : "the end of the video"
        }. Ignore content outside that clip and do not report timestamps beyond the selected window.`
      : "";

  return [
    basePrompt,
    buildLanguageInstruction(),
    clipScopePrompt,
    analysisPrompt ? `Additional analysis focus:\n${analysisPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildChunkPrompt(
  analysisPrompt: string | undefined,
  chunk: ChunkPlanItem,
  durationSeconds: number
): string {
  return [
    buildPrompt(analysisPrompt, chunk.startOffsetSeconds, chunk.endOffsetSeconds),
    `This is chunk ${chunk.index + 1} of the full video, which is ${durationSeconds} seconds long.`,
    "Treat this as an intermediate chunk analysis. Keep the summary concise, include at most 6 key moments, and note any open threads that may continue into later chunks.",
  ].join("\n\n");
}

export function buildChunkSynthesisPrompt(
  metadata: YtDlpMetadata,
  analysisPrompt: string | undefined,
  chunkResults: JsonObject[]
): string {
  return [
    "You are receiving JSON analyses for multiple chunks of the same YouTube video.",
    "Produce one consolidated JSON answer using the requested schema.",
    buildLanguageInstruction(),
    "Infer the dominant language from the chunk analyses and keep the final response consistent in that language.",
    metadata.title ? `Video title: ${metadata.title}` : "",
    metadata.uploader ? `Uploader: ${metadata.uploader}` : "",
    `Video duration in seconds: ${metadata.durationSeconds}`,
    analysisPrompt ? `Original analysis focus:\n${analysisPrompt}` : "",
    "Merge repeated topics, deduplicate quotes, keep a coherent global summary, and preserve only the most important key moments.",
    `Chunk analyses JSON:\n${JSON.stringify(chunkResults)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildFollowUpPrompt(analysisPrompt: string): string {
  return [
    "Return valid JSON only.",
    buildLanguageInstruction(),
    "Continue using the dominant language of the video for all natural-language field values.",
    analysisPrompt,
  ].join("\n\n");
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim();
}

async function readResponseText(response: unknown): Promise<string> {
  if (!response || typeof response !== "object") {
    return "";
  }

  const maybeResponse = response as {
    text?: string | (() => string | Promise<string>);
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (typeof maybeResponse.text === "function") {
    return (await maybeResponse.text())?.trim() ?? "";
  }

  if (typeof maybeResponse.text === "string") {
    return maybeResponse.text.trim();
  }

  return (
    maybeResponse.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function parseJsonText(rawText: string): unknown {
  try {
    return JSON.parse(stripCodeFences(rawText));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parsing error.";
    throw new Error(`Gemini did not return valid JSON: ${message}`);
  }
}

function ensureJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gemini did not return a JSON object.");
  }

  return value as JsonObject;
}

function buildGenerationConfig(
  responseSchema: JsonObject,
  timeoutMs: number | undefined,
  abortSignal: AbortSignal | undefined,
  cachedContent?: string,
  responseMode: "schema_json" | "text_plain_json" = "schema_json"
): JsonObject {
  return {
    ...createHttpConfig(timeoutMs, abortSignal),
    ...(cachedContent ? { cachedContent } : {}),
    ...(responseMode === "text_plain_json"
      ? { responseMimeType: "text/plain" }
      : {
          responseMimeType: "application/json",
          responseJsonSchema: responseSchema,
        }),
  };
}

export async function uploadVideoFile(
  ai: GoogleGenAI,
  downloadedVideo: DownloadedVideo,
  context: Omit<GeminiCallContext, "stage" | "code" | "failureMessage"> & {
    uploadFailureMessage: string;
    processingFailureMessage: string;
    uploadTimeoutMs?: number;
    processingDeadlineMs?: number;
    processingHeartbeatMessage?: string;
    reportHeartbeat?: (message: string) => Promise<void>;
  }
): Promise<UploadedVideoHandle> {
  const uploadTimeoutMs = context.uploadTimeoutMs ?? FILE_UPLOAD_TIMEOUT_MS;
  const uploadAbort = createTimedAbortController(uploadTimeoutMs, context.abortSignal);

  const uploaded = await runGeminiCall(
    () =>
      ai.files.upload({
        file: downloadedVideo.filePath,
        config: {
          mimeType: downloadedVideo.mimeType,
          displayName: path.basename(downloadedVideo.filePath),
          abortSignal: uploadAbort.signal,
        },
      }),
    {
      ...context,
      stage: "upload",
      code: "GEMINI_FILE_UPLOAD_FAILED",
      failureMessage: context.uploadFailureMessage,
      inputMode: "uploaded_file",
      maxAttempts: 2,
      timeoutMs: uploadTimeoutMs,
      abortSignal: uploadAbort.signal,
    }
  ).finally(() => uploadAbort.cleanup());

  if (!uploaded.name) {
    throw new DiagnosticError({
      tool: context.tool,
      code: "GEMINI_FILE_UPLOAD_FAILED",
      stage: "upload",
      message: context.uploadFailureMessage,
      retryable: false,
      strategyRequested: context.strategyRequested,
      strategyAttempted: context.strategyAttempted,
      details: { reason: "missing_uploaded_name", failureKind: "provider_error" },
    });
  }

  const uploadedName = uploaded.name;
  const deadline = Date.now() + (context.processingDeadlineMs ?? FILE_PROCESSING_DEADLINE_MS);
  let currentFile = uploaded;
  let pollAttempt = 0;

  while (Date.now() < deadline) {
    throwIfAborted(context.abortSignal);
    pollAttempt += 1;

    if (currentFile.state === "ACTIVE" && currentFile.uri) {
      context.logger.info("gemini.file_ready", {
        stage: "file_processing",
        attempts: pollAttempt,
        fileName: uploaded.name,
      });
      return {
        fileName: uploaded.name,
        fileUri: currentFile.uri,
        mimeType: currentFile.mimeType || downloadedVideo.mimeType,
      };
    }

    if (currentFile.state === "FAILED") {
      throw new DiagnosticError({
        tool: context.tool,
        code: "GEMINI_FILE_PROCESSING_FAILED",
        stage: "file_processing",
        message: context.processingFailureMessage,
        retryable: false,
        strategyRequested: context.strategyRequested,
        strategyAttempted: context.strategyAttempted,
        details: { fileName: uploaded.name, providerState: currentFile.state, failureKind: "provider_error" },
      });
    }

    if (pollAttempt % 15 === 0) {
      await context.reportHeartbeat?.(
        context.processingHeartbeatMessage ?? "Waiting for Gemini to process the uploaded video file."
      );
    }

    await sleep(FILE_PROCESSING_POLL_INTERVAL_MS, context.abortSignal);
    currentFile = await runGeminiCall(
      () =>
        ai.files.get({
          name: uploadedName,
          config: createHttpConfig(TOKEN_COUNT_TIMEOUT_MS, context.abortSignal),
        }),
      {
        ...context,
        stage: "file_processing",
        code: "GEMINI_FILE_PROCESSING_FAILED",
        failureMessage: context.processingFailureMessage,
        inputMode: "uploaded_file",
        maxAttempts: 2,
        timeoutMs: TOKEN_COUNT_TIMEOUT_MS,
        details: { fileName: uploadedName, pollAttempt },
      }
    );
  }

  throw new DiagnosticError({
    tool: context.tool,
    code: "GEMINI_FILE_PROCESSING_FAILED",
    stage: "file_processing",
    message: context.processingFailureMessage,
    retryable: true,
    strategyRequested: context.strategyRequested,
    strategyAttempted: context.strategyAttempted,
    details: {
      fileName: uploadedName,
      reason: "processing_deadline_exceeded",
      failureKind: "local_timeout",
      deadlineMs: context.processingDeadlineMs ?? FILE_PROCESSING_DEADLINE_MS,
    },
  });
}

export function buildVideoPart(source: VideoSource, options: VideoPartOptions = {}): JsonObject {
  const part: JsonObject = {
    fileData: {
      fileUri: source.kind === "youtube_url" ? source.normalizedYoutubeUrl : source.uploadedFile.fileUri,
      mimeType: source.kind === "youtube_url" ? "video/*" : source.uploadedFile.mimeType,
    },
  };

  if (source.kind === "uploaded_file" && options.mediaResolution) {
    part.mediaResolution = { level: options.mediaResolution };
  }

  if (options.startOffsetSeconds !== undefined || options.endOffsetSeconds !== undefined || options.fps !== undefined) {
    part.videoMetadata = {
      ...(options.startOffsetSeconds !== undefined ? { startOffset: toDurationString(options.startOffsetSeconds) } : {}),
      ...(options.endOffsetSeconds !== undefined ? { endOffset: toDurationString(options.endOffsetSeconds) } : {}),
      ...(options.fps !== undefined ? { fps: options.fps } : {}),
    };
  }

  return part;
}

export async function countTokensForRequest(
  ai: GoogleGenAI,
  params: {
    model: string;
    prompt: string;
    videoPart?: JsonObject;
  },
  context: GenerationContext
): Promise<number> {
  const parts: JsonObject[] = [];
  if (params.videoPart) {
    parts.push(params.videoPart);
  }
  parts.push({ text: params.prompt });

  const response = await runGeminiCall(
    () =>
      ai.models.countTokens({
        model: params.model,
        contents: [{ role: "user", parts }],
        config: createHttpConfig(context.timeoutMs ?? TOKEN_COUNT_TIMEOUT_MS, context.abortSignal),
      }),
    {
      logger: context.logger,
      tool: context.tool,
      stage: context.stage,
      code: context.code,
      failureMessage: context.failureMessage,
      strategyRequested: context.strategyRequested,
      strategyAttempted: context.strategyAttempted,
      model: params.model,
      inputMode: context.inputMode,
      responseMode: context.responseMode,
      details: context.details,
      timeoutMs: context.timeoutMs ?? TOKEN_COUNT_TIMEOUT_MS,
      abortSignal: context.abortSignal,
    }
  );

  return response.totalTokens ?? 0;
}

export async function generateStructuredJson(
  ai: GoogleGenAI,
  params: {
    model: string;
    prompt: string;
    responseSchema: JsonObject;
    videoPart?: JsonObject;
    cachedContent?: string;
    allowTextJsonFallback?: boolean;
    responseModeOverride?: "schema_json" | "text_plain_json";
  },
  context: GenerationContext
): Promise<JsonObject> {
  const parts: JsonObject[] = [];
  if (params.videoPart) {
    parts.push(params.videoPart);
  }
  parts.push({ text: params.prompt });

  const tryGenerate = async (responseMode: "schema_json" | "text_plain_json") => {
    const response = await runGeminiCall(
      () =>
        ai.models.generateContent({
          model: params.model,
          contents: [{ role: "user", parts }],
          config: buildGenerationConfig(
            params.responseSchema,
            context.timeoutMs ?? GENERATION_TIMEOUT_MS,
            context.abortSignal,
            params.cachedContent,
            responseMode
          ),
        }),
      {
        logger: context.logger,
        tool: context.tool,
        stage: context.stage,
        code: context.code,
        failureMessage: context.failureMessage,
        strategyRequested: context.strategyRequested,
        strategyAttempted: context.strategyAttempted,
        model: params.model,
        inputMode: context.inputMode,
        responseMode,
        details: context.details,
        timeoutMs: context.timeoutMs ?? GENERATION_TIMEOUT_MS,
        abortSignal: context.abortSignal,
      }
    );

    const rawText = await readResponseText(response);
    if (!rawText) {
      throw new DiagnosticError({
        tool: context.tool,
        code: context.code,
        stage: context.stage,
        message: context.failureMessage,
        retryable: false,
        strategyRequested: context.strategyRequested,
        strategyAttempted: context.strategyAttempted,
        details: {
          ...context.details,
          model: params.model,
          inputMode: context.inputMode,
          responseMode,
          reason: "empty_response",
          failureKind: "provider_error",
        },
      });
    }

    const parsed = ensureJsonObject(parseJsonText(rawText));
    validateJsonObjectAgainstSchema(params.responseSchema, parsed);
    return parsed;
  };

  const primaryMode = params.responseModeOverride ?? "schema_json";

  try {
    return await tryGenerate(primaryMode);
  } catch (error) {
    const allowFallback = params.allowTextJsonFallback && ALLOW_GEMINI_TEXT_JSON_FALLBACK && primaryMode === "schema_json";
    if (!allowFallback || isAbortError(error)) {
      if (error instanceof DiagnosticError) {
        throw error;
      }

      throw new DiagnosticError({
        tool: context.tool,
        code: context.code,
        stage: context.stage,
        message: context.failureMessage,
        retryable: false,
        strategyRequested: context.strategyRequested,
        strategyAttempted: context.strategyAttempted,
        cause: error,
        details: {
          ...context.details,
          model: params.model,
          inputMode: context.inputMode,
          responseMode: primaryMode,
          reason: "invalid_json_response",
          failureKind: "provider_error",
        },
      });
    }

    context.logger.warn("gemini.schema_mode_fallback", {
      stage: context.stage,
      code: context.code,
      model: params.model,
    });

    return await tryGenerate("text_plain_json");
  }
}

export async function estimateTokenBudget(
  ai: GoogleGenAI,
  params: { model: string; uploadedFile: UploadedVideoHandle; prompt: string },
  context: Omit<GeminiCallContext, "stage" | "code" | "failureMessage"> & { failureMessage: string }
): Promise<TokenBudgetDecision> {
  const inputTokenLimit = getInputTokenLimit(params.model);
  const thresholdTokens = Math.floor(inputTokenLimit * TOKEN_BUDGET_RATIO);
  const attempts: TokenBudgetAttempt[] = [];

  for (const fps of TOKEN_BUDGET_FPS_CANDIDATES) {
    const videoPart = buildVideoPart(
      { kind: "uploaded_file", uploadedFile: params.uploadedFile },
      { fps }
    );

    const totalTokens = await countTokensForRequest(
      ai,
      {
        model: params.model,
        prompt: params.prompt,
        videoPart,
      },
      {
        logger: context.logger,
        tool: context.tool,
        stage: "token_budget",
        code: "GEMINI_COUNT_TOKENS_FAILED",
        failureMessage: context.failureMessage,
        strategyRequested: context.strategyRequested,
        strategyAttempted: context.strategyAttempted,
        inputMode: "uploaded_file",
        responseMode: "schema_json",
        details: { fps },
        timeoutMs: TOKEN_COUNT_TIMEOUT_MS,
        abortSignal: context.abortSignal,
      }
    );

    const attempt: TokenBudgetAttempt = {
      fps,
      totalTokens,
      thresholdTokens,
      fitsBudget: totalTokens > 0 && totalTokens <= thresholdTokens,
    };
    attempts.push(attempt);

    if (attempt.fitsBudget) {
      context.logger.info("long_video.token_budget_selected", {
        model: params.model,
        fps,
        totalTokens,
        thresholdTokens,
      });
      return { model: params.model, inputTokenLimit, thresholdTokens, selectedAttempt: attempt, attempts };
    }
  }

  context.logger.warn("long_video.token_budget_exceeded", {
    model: params.model,
    thresholdTokens,
    attempts: attempts.map((attempt) => ({ fps: attempt.fps, totalTokens: attempt.totalTokens })),
  });

  return { model: params.model, inputTokenLimit, thresholdTokens, selectedAttempt: null, attempts };
}

export async function maybeCreateCache(
  ai: GoogleGenAI,
  params: {
    model: string;
    uploadedFile: UploadedVideoHandle;
    fps: number;
    mediaResolution?: typeof LOW_MEDIA_RESOLUTION;
    displayName: string;
  },
  context: Omit<GeminiCallContext, "stage" | "code" | "failureMessage"> & { failureMessage: string }
): Promise<{ name: string; expireTime: string | null } | null> {
  try {
    const videoPart = buildVideoPart(
      { kind: "uploaded_file", uploadedFile: params.uploadedFile },
      { fps: params.fps, mediaResolution: params.mediaResolution }
    );
    const cache = await runGeminiCall(
      () =>
        ai.caches.create({
          model: params.model,
          config: {
            displayName: params.displayName,
            ttl: `${DEFAULT_CACHE_TTL_SECONDS}s`,
            contents: [{ role: "user", parts: [videoPart] }],
            ...createHttpConfig(CACHE_CREATE_TIMEOUT_MS, context.abortSignal),
          },
        }),
      {
        ...context,
        stage: "cache_create",
        code: "GEMINI_CACHE_CREATE_FAILED",
        failureMessage: context.failureMessage,
        model: params.model,
        inputMode: "uploaded_file",
        details: {
          fps: params.fps,
          mediaResolution: params.mediaResolution ?? null,
          displayName: params.displayName,
        },
        maxAttempts: 2,
        timeoutMs: CACHE_CREATE_TIMEOUT_MS,
      }
    );

    return cache.name ? { name: cache.name, expireTime: cache.expireTime || null } : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.logger.warn("long_video.cache_skipped", {
      message,
      model: params.model,
      fps: params.fps,
      mediaResolution: params.mediaResolution ?? null,
      displayName: params.displayName,
    });
    return null;
  }
}

export const GEMINI_DEFAULT_TIMEOUTS = {
  upload: FILE_UPLOAD_TIMEOUT_MS,
  tokenCount: TOKEN_COUNT_TIMEOUT_MS,
  generation: GENERATION_TIMEOUT_MS,
  synthesis: SYNTHESIS_TIMEOUT_MS,
  processingDeadline: FILE_PROCESSING_DEADLINE_MS,
} as const;






