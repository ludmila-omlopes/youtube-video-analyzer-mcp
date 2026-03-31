import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { GoogleGenAI } from "@google/genai";

import {
  DEFAULT_AUDIO_ANALYSIS_MODEL,
  DEFAULT_CHUNK_OVERLAP_SECONDS,
  DEFAULT_LONG_VIDEO_CHUNK_MODEL,
  DEFAULT_LONG_VIDEO_FINAL_MODEL,
  DEFAULT_MODEL,
  DOWNLOAD_TIMEOUT_MS,
  GENERATION_TIMEOUT_MS,
  LOW_MEDIA_RESOLUTION,
  METADATA_TIMEOUT_MS,
  MIN_CHUNK_DURATION_SECONDS,
  MODEL_INPUT_TOKEN_LIMITS,
  SYNTHESIS_TIMEOUT_MS,
  TOKEN_BUDGET_FPS_CANDIDATES,
  TOKEN_BUDGET_RATIO,
} from "./constants.js";
import { createAdaptiveBatchPlan, createAdaptiveChunkPlan } from "./chunk-planner.js";
import { DiagnosticError, asDiagnosticError } from "./errors.js";
import {
  buildAudioAnalysisPrompt,
  buildChunkPrompt,
  buildChunkSynthesisPrompt,
  buildFollowUpPrompt,
  buildPrompt,
  buildVideoPart,
  countTokensForRequest,
  estimateTokenBudget,
  generateStructuredJson,
  maybeCreateCache,
  uploadVideoFile,
} from "./gemini.js";
import type { Logger } from "./logger.js";
import { fetchLongVideoMetadata } from "./youtube-metadata.js";
import {
  chunkAnalysisSchema,
  defaultAudioAnalysisSchema,
  type AudioToolInput,
  type AudioToolOutput,
  type FollowUpToolInput,
  type FollowUpToolOutput,
  type LongToolInput,
  type LongToolOutput,
  parseSchema,
  type ShortToolInput,
  type ShortToolOutput,
} from "./schemas.js";
import type {
  AnalysisSession,
  ChunkPlanItem,
  JsonObject,
  ProgressReporter,
  TokenBudgetDecision,
  UploadedVideoHandle,
  YtDlpMetadata,
} from "./types.js";
import { downloadYouTubeVideo, downloadYouTubeVideoSegment, normalizeYouTubeUrl } from "./youtube.js";
import type { AnalysisSessionStore } from "../app/session-store.js";

const CONSERVATIVE_URL_CHUNK_DURATION_SECONDS = 600;

type MediaOption = {
  fps?: number;
  mediaResolution?: typeof LOW_MEDIA_RESOLUTION;
  label: string;
};

export type AnalysisExecutionContext = {
  logger: Logger;
  tool: string;
  abortSignal?: AbortSignal;
  reportProgress?: ProgressReporter;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(signal.reason ? String(signal.reason) : "Request aborted.");
  }
}

async function reportProgress(
  context: AnalysisExecutionContext,
  progress: number,
  total: number | undefined,
  message: string
): Promise<void> {
  context.logger.info("tool.progress", { progress, total: total ?? null, message });
  if (context.reportProgress) {
    await context.reportProgress({ progress, total, message });
  }
}

function getInputTokenLimit(model: string): number {
  return MODEL_INPUT_TOKEN_LIMITS[model] ?? 1_048_576;
}

function getThresholdTokens(model: string): number {
  return Math.floor(getInputTokenLimit(model) * TOKEN_BUDGET_RATIO);
}

function buildUploadedFileMediaOptions(): MediaOption[] {
  return [
    { fps: 1, label: "fps_1" },
    { fps: 0.5, label: "fps_0_5" },
    { fps: 0.25, label: "fps_0_25" },
  ];
}

function buildUrlChunkMediaOptions(): MediaOption[] {
  return TOKEN_BUDGET_FPS_CANDIDATES.map((fps) => ({ fps, label: `fps_${String(fps).replace(".", "_")}` }));
}

function createConservativeChunkPlan(durationSeconds: number): ChunkPlanItem[] {
  const chunks: ChunkPlanItem[] = [];
  let index = 0;
  let startOffsetSeconds = 0;
  const totalDuration = Math.max(1, Math.ceil(durationSeconds));

  while (startOffsetSeconds < totalDuration) {
    const endOffsetSeconds = Math.min(startOffsetSeconds + CONSERVATIVE_URL_CHUNK_DURATION_SECONDS, totalDuration);
    chunks.push({ index, startOffsetSeconds, endOffsetSeconds });
    if (endOffsetSeconds >= totalDuration) {
      break;
    }

    startOffsetSeconds = Math.max(endOffsetSeconds - DEFAULT_CHUNK_OVERLAP_SECONDS, startOffsetSeconds + 1);
    index += 1;
  }

  return chunks;
}

async function createSession(
  sessionStore: AnalysisSessionStore,
  session: Omit<AnalysisSession, "sessionId" | "createdAt">
): Promise<AnalysisSession> {
  const created: AnalysisSession = {
    ...session,
    sessionId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await sessionStore.set(created);
  return created;
}

function buildLongVideoResult(params: {
  input: LongToolInput;
  normalizedYoutubeUrl: string;
  metadata: YtDlpMetadata;
  strategyRequested: string;
  strategyUsed: string;
  fallbackReason: string | null;
  modelsUsed: { chunkModel: string; finalModel: string };
  chunkPlan: ChunkPlanItem[] | null;
  tokenBudget: TokenBudgetDecision | null;
  cacheUsed: boolean;
  sessionId: string | null;
  cacheName: string | null;
  analysis: JsonObject;
}): LongToolOutput {
  return {
    youtubeUrl: params.input.youtubeUrl,
    normalizedYoutubeUrl: params.normalizedYoutubeUrl,
    title: params.metadata.title,
    durationSeconds: params.metadata.durationSeconds,
    strategyRequested: params.strategyRequested,
    strategyUsed: params.strategyUsed,
    fallbackReason: params.fallbackReason,
    modelsUsed: params.modelsUsed,
    chunkPlan: params.chunkPlan,
    chunkCount: params.chunkPlan?.length ?? 0,
    tokenBudget: params.tokenBudget,
    cacheUsed: params.cacheUsed,
    sessionId: params.sessionId,
    cacheName: params.cacheName,
    usedCustomSchema: Boolean(params.input.responseSchemaJson),
    analysis: params.analysis,
  };
}

function categorizeUploadedFileFallback(error: DiagnosticError): string {
  if (error.stage === "upload") {
    return "upload failed";
  }
  if (error.stage === "file_processing" && error.details?.reason === "processing_deadline_exceeded") {
    return "file processing exceeded deadline";
  }
  if (error.stage === "single_pass_generate" && error.details?.reason === "invalid_json_response") {
    return "structured output failed";
  }
  if (["single_pass_generate", "chunk_generate", "chunk_synthesis"].includes(error.stage)) {
    return "generation failed";
  }
  return error.message;
}

async function chooseSinglePassMediaOption(
  ai: GoogleGenAI,
  params: {
    uploadedFile: UploadedVideoHandle;
    prompt: string;
    model: string;
    strategyRequested: string;
    strategyAttempted: string;
  },
  context: AnalysisExecutionContext
): Promise<MediaOption | null> {
  const thresholdTokens = getThresholdTokens(params.model);

  for (const option of buildUploadedFileMediaOptions()) {
    throwIfAborted(context.abortSignal);
    const totalTokens = await countTokensForRequest(
      ai,
      {
        model: params.model,
        prompt: params.prompt,
        videoPart: buildVideoPart(
          { kind: "uploaded_file", uploadedFile: params.uploadedFile },
          { fps: option.fps, mediaResolution: option.mediaResolution }
        ),
      },
      {
        logger: context.logger,
        tool: context.tool,
        stage: "token_budget",
        code: "GEMINI_COUNT_TOKENS_FAILED",
        failureMessage: "Failed to estimate token budget for uploaded-file single-pass analysis.",
        strategyRequested: params.strategyRequested,
        strategyAttempted: params.strategyAttempted,
        inputMode: "uploaded_file",
        responseMode: "schema_json",
        details: { scope: "single_pass", fps: option.fps ?? null, mediaResolution: option.mediaResolution ?? null },
        abortSignal: context.abortSignal,
      }
    );

    if (totalTokens > 0 && totalTokens <= thresholdTokens) {
      return option;
    }
  }

  return null;
}
async function chooseAdaptiveChunkPlanForUploadedFile(
  ai: GoogleGenAI,
  params: {
    uploadedFile: UploadedVideoHandle;
    metadata: YtDlpMetadata;
    analysisPrompt?: string;
    chunkModel: string;
    strategyRequested: string;
  },
  context: AnalysisExecutionContext
): Promise<{ chunkPlan: ChunkPlanItem[]; mediaOption: MediaOption }> {
  const thresholdTokens = getThresholdTokens(params.chunkModel);
  let bestPlan: { chunkPlan: ChunkPlanItem[]; mediaOption: MediaOption } | null = null;

  for (const option of buildUploadedFileMediaOptions()) {
    try {
      const chunkPlan = await createAdaptiveChunkPlan({
        durationSeconds: params.metadata.durationSeconds,
        overlapSeconds: DEFAULT_CHUNK_OVERLAP_SECONDS,
        minChunkDurationSeconds: MIN_CHUNK_DURATION_SECONDS,
        canFitChunk: async (startOffsetSeconds, endOffsetSeconds) => {
          const totalTokens = await countTokensForRequest(
            ai,
            {
              model: params.chunkModel,
              prompt: buildChunkPrompt(
                params.analysisPrompt,
                { index: 0, startOffsetSeconds, endOffsetSeconds },
                params.metadata.durationSeconds
              ),
              videoPart: buildVideoPart(
                { kind: "uploaded_file", uploadedFile: params.uploadedFile },
                {
                  startOffsetSeconds,
                  endOffsetSeconds,
                  fps: option.fps,
                  mediaResolution: option.mediaResolution,
                }
              ),
            },
            {
              logger: context.logger,
              tool: context.tool,
              stage: "token_budget",
              code: "GEMINI_COUNT_TOKENS_FAILED",
              failureMessage: "Failed to estimate token budget for uploaded-file chunk planning.",
              strategyRequested: params.strategyRequested,
              strategyAttempted: "uploaded_file_chunks",
              inputMode: "uploaded_file",
              responseMode: "schema_json",
              details: {
                scope: "chunk_planning",
                fps: option.fps ?? null,
                mediaResolution: option.mediaResolution ?? null,
                startOffsetSeconds,
                endOffsetSeconds,
              },
              abortSignal: context.abortSignal,
            }
          );

          return totalTokens > 0 && totalTokens <= thresholdTokens;
        },
      });

      if (!bestPlan || chunkPlan.length < bestPlan.chunkPlan.length) {
        bestPlan = { chunkPlan, mediaOption: option };
      }
    } catch (error) {
      const diagnostic = asDiagnosticError(error, {
        tool: context.tool,
        code: "LONG_VIDEO_CHUNK_PLANNING_FAILED",
        stage: "token_budget",
        message: "Uploaded-file chunk planning failed.",
        strategyRequested: params.strategyRequested,
        strategyAttempted: "uploaded_file_chunks",
      });

      if (diagnostic.code === "REQUEST_CANCELLED") {
        throw diagnostic;
      }

      context.logger.warn("long_video.chunk_planning_candidate_failed", {
        strategyAttempted: "uploaded_file_chunks",
        mediaOption: option.label,
        message: diagnostic.message,
        causeMessage: diagnostic.causeMessage,
      });
    }
  }

  if (!bestPlan) {
    throw new DiagnosticError({
      tool: context.tool,
      code: "LONG_VIDEO_CHUNK_PLANNING_FAILED",
      stage: "token_budget",
      message: "Failed to build an uploaded-file chunk plan that fits the model budget.",
      retryable: false,
      strategyRequested: params.strategyRequested,
      strategyAttempted: "uploaded_file_chunks",
      details: { durationSeconds: params.metadata.durationSeconds },
    });
  }

  return bestPlan;
}

async function chooseAdaptiveChunkPlanForUrl(
  ai: GoogleGenAI,
  params: {
    normalizedYoutubeUrl: string;
    metadata: YtDlpMetadata;
    analysisPrompt?: string;
    chunkModel: string;
    strategyRequested: string;
  },
  context: AnalysisExecutionContext
): Promise<{ chunkPlan: ChunkPlanItem[]; mediaOption: MediaOption; usedConservativePlan: boolean }> {
  const thresholdTokens = getThresholdTokens(params.chunkModel);
  let bestPlan: { chunkPlan: ChunkPlanItem[]; mediaOption: MediaOption } | null = null;

  for (const option of buildUrlChunkMediaOptions()) {
    try {
      const chunkPlan = await createAdaptiveChunkPlan({
        durationSeconds: params.metadata.durationSeconds,
        overlapSeconds: DEFAULT_CHUNK_OVERLAP_SECONDS,
        minChunkDurationSeconds: MIN_CHUNK_DURATION_SECONDS,
        canFitChunk: async (startOffsetSeconds, endOffsetSeconds) => {
          const totalTokens = await countTokensForRequest(
            ai,
            {
              model: params.chunkModel,
              prompt: buildChunkPrompt(
                params.analysisPrompt,
                { index: 0, startOffsetSeconds, endOffsetSeconds },
                params.metadata.durationSeconds
              ),
              videoPart: buildVideoPart(
                { kind: "youtube_url", normalizedYoutubeUrl: params.normalizedYoutubeUrl },
                { startOffsetSeconds, endOffsetSeconds, fps: option.fps }
              ),
            },
            {
              logger: context.logger,
              tool: context.tool,
              stage: "token_budget",
              code: "GEMINI_COUNT_TOKENS_FAILED",
              failureMessage: "Failed to estimate token budget for URL chunk planning.",
              strategyRequested: params.strategyRequested,
              strategyAttempted: "url_chunks",
              inputMode: "youtube_url",
              responseMode: "schema_json",
              details: { scope: "chunk_planning", fps: option.fps ?? null, startOffsetSeconds, endOffsetSeconds },
              abortSignal: context.abortSignal,
            }
          );

          return totalTokens > 0 && totalTokens <= thresholdTokens;
        },
      });

      if (!bestPlan || chunkPlan.length < bestPlan.chunkPlan.length) {
        bestPlan = { chunkPlan, mediaOption: option };
      }
    } catch (error) {
      const diagnostic = asDiagnosticError(error, {
        tool: context.tool,
        code: "LONG_VIDEO_URL_CHUNK_PLANNING_FAILED",
        stage: "token_budget",
        message: "URL chunk planning failed.",
        strategyRequested: params.strategyRequested,
        strategyAttempted: "url_chunks",
      });

      if (diagnostic.code === "REQUEST_CANCELLED") {
        throw diagnostic;
      }

      context.logger.warn("long_video.url_chunk_planning_candidate_failed", {
        strategyAttempted: "url_chunks",
        mediaOption: option.label,
        message: diagnostic.message,
        causeMessage: diagnostic.causeMessage,
      });
    }
  }

  if (bestPlan) {
    return { ...bestPlan, usedConservativePlan: false };
  }

  const fallbackOption = buildUrlChunkMediaOptions()[buildUrlChunkMediaOptions().length - 1];
  context.logger.warn("long_video.url_chunk_planning_conservative_fallback", {
    durationSeconds: params.metadata.durationSeconds,
    fps: fallbackOption.fps ?? null,
  });

  return {
    chunkPlan: createConservativeChunkPlan(params.metadata.durationSeconds),
    mediaOption: fallbackOption,
    usedConservativePlan: true,
  };
}

async function synthesizeChunkAnalyses(
  ai: GoogleGenAI,
  params: {
    metadata: YtDlpMetadata;
    analysisPrompt?: string;
    analyses: JsonObject[];
    finalModel: string;
    responseSchema: JsonObject;
    strategyRequested: string;
    strategyAttempted: string;
  },
  context: AnalysisExecutionContext
): Promise<JsonObject> {
  let round = 1;
  let currentAnalyses = params.analyses;

  while (true) {
    throwIfAborted(context.abortSignal);
    const thresholdTokens = getThresholdTokens(params.finalModel);

    const batchPlan = await createAdaptiveBatchPlan({
      totalItems: currentAnalyses.length,
      canFitBatch: async (startIndex, endIndex) => {
        const totalTokens = await countTokensForRequest(
          ai,
          {
            model: params.finalModel,
            prompt: buildChunkSynthesisPrompt(
              params.metadata,
              params.analysisPrompt,
              currentAnalyses.slice(startIndex, endIndex)
            ),
          },
          {
            logger: context.logger,
            tool: context.tool,
            stage: "token_budget",
            code: "GEMINI_COUNT_TOKENS_FAILED",
            failureMessage: "Failed to estimate token budget for long-video synthesis.",
            strategyRequested: params.strategyRequested,
            strategyAttempted: params.strategyAttempted,
            inputMode: "text_only",
            responseMode: "schema_json",
            details: { round, startIndex, endIndex },
            abortSignal: context.abortSignal,
          }
        );

        return totalTokens > 0 && totalTokens <= thresholdTokens;
      },
    });

    const nextAnalyses: JsonObject[] = [];
    for (const batch of batchPlan) {
      const batchIndex = batch.index + 1;
      await reportProgress(
        context,
        batchIndex,
        batchPlan.length,
        batchPlan.length === 1 && round === 1
          ? "Synthesizing long-video analysis."
          : `Synthesizing analysis batch ${batchIndex}/${batchPlan.length} (round ${round}).`
      );

      const analysis = await generateStructuredJson(
        ai,
        {
          model: params.finalModel,
          prompt: buildChunkSynthesisPrompt(
            params.metadata,
            params.analysisPrompt,
            currentAnalyses.slice(batch.startIndex, batch.endIndex)
          ),
          responseSchema: params.responseSchema,
        },
        {
          logger: context.logger,
          tool: context.tool,
          stage: "chunk_synthesis",
          code: "LONG_VIDEO_SYNTHESIS_FAILED",
          failureMessage: "Failed to synthesize the long-video chunk analyses.",
          strategyRequested: params.strategyRequested,
          strategyAttempted: params.strategyAttempted,
          inputMode: "text_only",
          responseMode: "schema_json",
          details: { round, batchIndex, batchCount: batchPlan.length, itemCount: batch.endIndex - batch.startIndex },
          timeoutMs: SYNTHESIS_TIMEOUT_MS,
          abortSignal: context.abortSignal,
        }
      );

      nextAnalyses.push(analysis);
    }

    if (nextAnalyses.length === 1) {
      return nextAnalyses[0];
    }

    currentAnalyses = nextAnalyses;
    round += 1;
  }
}

async function analyzeChunkedVideo(
  ai: GoogleGenAI,
  params: {
    source:
      | { kind: "youtube_url"; normalizedYoutubeUrl: string }
      | { kind: "uploaded_file"; uploadedFile: UploadedVideoHandle };
    metadata: YtDlpMetadata;
    chunkPlan: ChunkPlanItem[];
    mediaOption: MediaOption;
    analysisPrompt?: string;
    chunkModel: string;
    finalModel: string;
    responseSchema: JsonObject;
    strategyRequested: string;
    strategyAttempted: "url_chunks" | "uploaded_file_chunks";
  },
  context: AnalysisExecutionContext
): Promise<{ analysis: JsonObject; chunkPlan: ChunkPlanItem[] }> {
  const chunkAnalyses: JsonObject[] = [];

  for (const chunk of params.chunkPlan) {
    throwIfAborted(context.abortSignal);
    await reportProgress(
      context,
      chunk.index + 1,
      params.chunkPlan.length + 1,
      `Analyzing chunk ${chunk.index + 1}/${params.chunkPlan.length}.`
    );

    const videoPart =
      params.source.kind === "youtube_url"
        ? buildVideoPart(
            { kind: "youtube_url", normalizedYoutubeUrl: params.source.normalizedYoutubeUrl },
            {
              startOffsetSeconds: chunk.startOffsetSeconds,
              endOffsetSeconds: chunk.endOffsetSeconds,
              fps: params.mediaOption.fps,
            }
          )
        : buildVideoPart(
            { kind: "uploaded_file", uploadedFile: params.source.uploadedFile },
            {
              startOffsetSeconds: chunk.startOffsetSeconds,
              endOffsetSeconds: chunk.endOffsetSeconds,
              fps: params.mediaOption.fps,
              mediaResolution: params.mediaOption.mediaResolution,
            }
          );

    const chunkResult = await generateStructuredJson(
      ai,
      {
        model: params.chunkModel,
        prompt: buildChunkPrompt(params.analysisPrompt, chunk, params.metadata.durationSeconds),
        responseSchema: chunkAnalysisSchema as JsonObject,
        videoPart,
      },
      {
        logger: context.logger,
        tool: context.tool,
        stage: "chunk_generate",
        code: "LONG_VIDEO_CHUNK_FAILED",
        failureMessage: "Failed to analyze a long-video chunk.",
        strategyRequested: params.strategyRequested,
        strategyAttempted: params.strategyAttempted,
        inputMode: params.source.kind === "youtube_url" ? "youtube_url" : "uploaded_file",
        responseMode: "schema_json",
        details: {
          chunkIndex: chunk.index,
          chunkStartOffsetSeconds: chunk.startOffsetSeconds,
          chunkEndOffsetSeconds: chunk.endOffsetSeconds,
          fps: params.mediaOption.fps ?? null,
          mediaResolution: params.mediaOption.mediaResolution ?? null,
        },
        timeoutMs: GENERATION_TIMEOUT_MS,
        abortSignal: context.abortSignal,
      }
    );

    chunkAnalyses.push({ chunk, analysis: chunkResult });
  }

  const analysis = await synthesizeChunkAnalyses(
    ai,
    {
      metadata: params.metadata,
      analysisPrompt: params.analysisPrompt,
      analyses: chunkAnalyses,
      finalModel: params.finalModel,
      responseSchema: params.responseSchema,
      strategyRequested: params.strategyRequested,
      strategyAttempted: params.strategyAttempted,
    },
    context
  );

  return { analysis, chunkPlan: params.chunkPlan };
}

async function analyzeUploadedFileChunksViaSegmentUploads(
  ai: GoogleGenAI,
  params: {
    normalizedYoutubeUrl: string;
    metadata: YtDlpMetadata;
    chunkPlan: ChunkPlanItem[];
    mediaOption: MediaOption;
    analysisPrompt?: string;
    chunkModel: string;
    finalModel: string;
    responseSchema: JsonObject;
    strategyRequested: string;
  },
  context: AnalysisExecutionContext
): Promise<{ analysis: JsonObject; chunkPlan: ChunkPlanItem[] }> {
  const chunkAnalyses: JsonObject[] = [];

  for (const chunk of params.chunkPlan) {
    throwIfAborted(context.abortSignal);
    await reportProgress(
      context,
      chunk.index + 1,
      params.chunkPlan.length + 1,
      `Analyzing chunk ${chunk.index + 1}/${params.chunkPlan.length}.`
    );

    let downloadedChunk: Awaited<ReturnType<typeof downloadYouTubeVideoSegment>> | null = null;

    try {
      try {
        downloadedChunk = await downloadYouTubeVideoSegment(
          params.normalizedYoutubeUrl,
          chunk.startOffsetSeconds,
          chunk.endOffsetSeconds,
          {
            signal: context.abortSignal,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          }
        );
      } catch (error) {
        throw asDiagnosticError(error, {
          tool: context.tool,
          code: "YTDLP_DOWNLOAD_FAILED",
          stage: "download",
          message: "Failed to download a video chunk for uploaded-file analysis.",
          strategyRequested: params.strategyRequested,
          strategyAttempted: "uploaded_file_chunks",
        });
      }

      await reportProgress(
        context,
        chunk.index + 1,
        params.chunkPlan.length + 1,
        `Uploading chunk ${chunk.index + 1}/${params.chunkPlan.length} to Gemini Files API.`
      );

      const uploadedFile = await uploadVideoFile(ai, downloadedChunk, {
        logger: context.logger,
        tool: context.tool,
        strategyRequested: params.strategyRequested,
        strategyAttempted: "uploaded_file_chunks",
        uploadFailureMessage: "Failed to upload a video chunk to Gemini Files API.",
        processingFailureMessage: "Failed while waiting for Gemini to process an uploaded video chunk.",
        processingHeartbeatMessage: `Waiting for Gemini to process chunk ${chunk.index + 1}/${params.chunkPlan.length}.`,
        reportHeartbeat: (message) => reportProgress(context, chunk.index + 1, params.chunkPlan.length + 1, message),
        abortSignal: context.abortSignal,
      });

      await reportProgress(
        context,
        chunk.index + 1,
        params.chunkPlan.length + 1,
        `Running Gemini analysis for chunk ${chunk.index + 1}/${params.chunkPlan.length}.`
      );

      const chunkResult = await generateStructuredJson(
        ai,
        {
          model: params.chunkModel,
          prompt: buildChunkPrompt(params.analysisPrompt, chunk, params.metadata.durationSeconds),
          responseSchema: chunkAnalysisSchema as JsonObject,
          videoPart: buildVideoPart(
            { kind: "uploaded_file", uploadedFile },
            { fps: params.mediaOption.fps, mediaResolution: params.mediaOption.mediaResolution }
          ),
        },
        {
          logger: context.logger,
          tool: context.tool,
          stage: "chunk_generate",
          code: "LONG_VIDEO_CHUNK_FAILED",
          failureMessage: "Failed to analyze a long-video chunk.",
          strategyRequested: params.strategyRequested,
          strategyAttempted: "uploaded_file_chunks",
          inputMode: "uploaded_file",
          responseMode: "schema_json",
          details: {
            chunkIndex: chunk.index,
            chunkStartOffsetSeconds: chunk.startOffsetSeconds,
            chunkEndOffsetSeconds: chunk.endOffsetSeconds,
            fps: params.mediaOption.fps ?? null,
            mediaResolution: params.mediaOption.mediaResolution ?? null,
          },
          timeoutMs: GENERATION_TIMEOUT_MS,
          abortSignal: context.abortSignal,
        }
      );

      chunkAnalyses.push({ chunk, analysis: chunkResult });
    } finally {
      if (downloadedChunk) {
        try {
          await fs.rm(downloadedChunk.tempDir, { recursive: true, force: true });
        } catch (error) {
          context.logger.warn("long_video.segment_cleanup_failed", {
            tempDir: downloadedChunk.tempDir,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  const analysis = await synthesizeChunkAnalyses(
    ai,
    {
      metadata: params.metadata,
      analysisPrompt: params.analysisPrompt,
      analyses: chunkAnalyses,
      finalModel: params.finalModel,
      responseSchema: params.responseSchema,
      strategyRequested: params.strategyRequested,
      strategyAttempted: "uploaded_file_chunks",
    },
    context
  );

  return { analysis, chunkPlan: params.chunkPlan };
}

export async function analyzeShortVideo(
  ai: GoogleGenAI,
  params: ShortToolInput,
  context: AnalysisExecutionContext
): Promise<ShortToolOutput> {
  if (
    params.startOffsetSeconds !== undefined &&
    params.endOffsetSeconds !== undefined &&
    params.endOffsetSeconds <= params.startOffsetSeconds
  ) {
    throw new Error("endOffsetSeconds must be greater than startOffsetSeconds.");
  }

  const normalizedYoutubeUrl = normalizeYouTubeUrl(params.youtubeUrl);
  if (!normalizedYoutubeUrl) {
    throw new Error("youtubeUrl must be a valid YouTube video URL.");
  }

  const analysis = await generateStructuredJson(
    ai,
    {
      model: params.model || DEFAULT_MODEL,
      prompt: buildPrompt(params.analysisPrompt, params.startOffsetSeconds, params.endOffsetSeconds),
      responseSchema: parseSchema(params.responseSchemaJson),
      videoPart: buildVideoPart(
        { kind: "youtube_url", normalizedYoutubeUrl },
        { startOffsetSeconds: params.startOffsetSeconds, endOffsetSeconds: params.endOffsetSeconds }
      ),
    },
    {
      logger: context.logger,
      tool: context.tool,
      stage: "short_video_generate",
      code: "SHORT_VIDEO_ANALYSIS_FAILED",
      failureMessage: "Failed to analyze the requested YouTube video clip.",
      inputMode: "youtube_url",
      responseMode: "schema_json",
      details: {
        startOffsetSeconds: params.startOffsetSeconds ?? null,
        endOffsetSeconds: params.endOffsetSeconds ?? null,
      },
      timeoutMs: GENERATION_TIMEOUT_MS,
      abortSignal: context.abortSignal,
    }
  );

  return {
    model: params.model || DEFAULT_MODEL,
    youtubeUrl: params.youtubeUrl,
    normalizedYoutubeUrl,
    clip: {
      startOffsetSeconds: params.startOffsetSeconds ?? null,
      endOffsetSeconds: params.endOffsetSeconds ?? null,
    },
    usedCustomSchema: Boolean(params.responseSchemaJson),
    analysis,
  };
}

export async function analyzeYouTubeVideoAudio(
  ai: GoogleGenAI,
  params: AudioToolInput,
  context: AnalysisExecutionContext
): Promise<AudioToolOutput> {
  if (
    params.startOffsetSeconds !== undefined &&
    params.endOffsetSeconds !== undefined &&
    params.endOffsetSeconds <= params.startOffsetSeconds
  ) {
    throw new Error("endOffsetSeconds must be greater than startOffsetSeconds.");
  }

  const normalizedYoutubeUrl = normalizeYouTubeUrl(params.youtubeUrl);
  if (!normalizedYoutubeUrl) {
    throw new Error("youtubeUrl must be a valid YouTube video URL.");
  }

  const analysis = await generateStructuredJson(
    ai,
    {
      model: params.model || DEFAULT_AUDIO_ANALYSIS_MODEL,
      prompt: buildAudioAnalysisPrompt(params.analysisPrompt, params.startOffsetSeconds, params.endOffsetSeconds),
      responseSchema: parseSchema(
        params.responseSchemaJson,
        defaultAudioAnalysisSchema as Record<string, unknown>
      ),
      videoPart: buildVideoPart(
        { kind: "youtube_url", normalizedYoutubeUrl },
        { startOffsetSeconds: params.startOffsetSeconds, endOffsetSeconds: params.endOffsetSeconds }
      ),
    },
    {
      logger: context.logger,
      tool: context.tool,
      stage: "short_video_generate",
      code: "AUDIO_ONLY_VIDEO_ANALYSIS_FAILED",
      failureMessage: "Failed to analyze the requested YouTube video from audio and transcription only.",
      inputMode: "youtube_url",
      responseMode: "schema_json",
      details: {
        startOffsetSeconds: params.startOffsetSeconds ?? null,
        endOffsetSeconds: params.endOffsetSeconds ?? null,
      },
      timeoutMs: GENERATION_TIMEOUT_MS,
      abortSignal: context.abortSignal,
    }
  );

  return {
    model: params.model || DEFAULT_AUDIO_ANALYSIS_MODEL,
    youtubeUrl: params.youtubeUrl,
    normalizedYoutubeUrl,
    clip: {
      startOffsetSeconds: params.startOffsetSeconds ?? null,
      endOffsetSeconds: params.endOffsetSeconds ?? null,
    },
    usedCustomSchema: Boolean(params.responseSchemaJson),
    analysis,
  };
}

async function runUrlChunkStrategy(
  ai: GoogleGenAI,
  params: LongToolInput,
  config: {
    normalizedYoutubeUrl: string;
    metadata: YtDlpMetadata;
    chunkModel: string;
    finalModel: string;
    responseSchema: JsonObject;
    strategyRequested: string;
    fallbackReason: string | null;
  },
  context: AnalysisExecutionContext
): Promise<LongToolOutput> {
  await reportProgress(context, 1, 4, "Planning long-video chunks from YouTube URL.");
  const plan = await chooseAdaptiveChunkPlanForUrl(
    ai,
    {
      normalizedYoutubeUrl: config.normalizedYoutubeUrl,
      metadata: config.metadata,
      analysisPrompt: params.analysisPrompt,
      chunkModel: config.chunkModel,
      strategyRequested: config.strategyRequested,
    },
    context
  );

  context.logger.info("long_video.strategy_selected", {
    strategyRequested: config.strategyRequested,
    strategyAttempted: "url_chunks",
    fallbackReason: config.fallbackReason,
    usedConservativePlan: plan.usedConservativePlan,
    fps: plan.mediaOption.fps ?? null,
  });

  const chunkedResult = await analyzeChunkedVideo(
    ai,
    {
      source: { kind: "youtube_url", normalizedYoutubeUrl: config.normalizedYoutubeUrl },
      metadata: config.metadata,
      chunkPlan: plan.chunkPlan,
      mediaOption: plan.mediaOption,
      analysisPrompt: params.analysisPrompt,
      chunkModel: config.chunkModel,
      finalModel: config.finalModel,
      responseSchema: config.responseSchema,
      strategyRequested: config.strategyRequested,
      strategyAttempted: "url_chunks",
    },
    context
  );

  return buildLongVideoResult({
    input: params,
    normalizedYoutubeUrl: config.normalizedYoutubeUrl,
    metadata: config.metadata,
    strategyRequested: config.strategyRequested,
    strategyUsed: "url_chunks",
    fallbackReason: config.fallbackReason,
    modelsUsed: { chunkModel: config.chunkModel, finalModel: config.finalModel },
    chunkPlan: chunkedResult.chunkPlan,
    tokenBudget: null,
    cacheUsed: false,
    sessionId: null,
    cacheName: null,
    analysis: chunkedResult.analysis,
  });
}

async function runUploadedFileStrategy(
  ai: GoogleGenAI,
  params: LongToolInput,
  config: {
    sessionStore: AnalysisSessionStore;
    normalizedYoutubeUrl: string;
    metadata: YtDlpMetadata;
    chunkModel: string;
    finalModel: string;
    responseSchema: JsonObject;
    strategyRequested: string;
    preferCache: boolean;
  },
  context: AnalysisExecutionContext
): Promise<LongToolOutput> {
  context.logger.info("long_video.strategy_selected", {
    strategyRequested: config.strategyRequested,
    strategyAttempted: "uploaded_file",
  });

  let downloadedVideo: Awaited<ReturnType<typeof downloadYouTubeVideo>> | null = null;

  try {
    await reportProgress(context, 1, 6, "Downloading YouTube video for Gemini Files API.");
    try {
      downloadedVideo = await downloadYouTubeVideo(config.normalizedYoutubeUrl, {
        signal: context.abortSignal,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
    } catch (error) {
      throw asDiagnosticError(error, {
        tool: context.tool,
        code: "YTDLP_DOWNLOAD_FAILED",
        stage: "download",
        message: "Failed to download the YouTube video for uploaded-file analysis.",
        strategyRequested: config.strategyRequested,
        strategyAttempted: "uploaded_file",
      });
    }

    await reportProgress(context, 2, 6, "Uploading video to Gemini Files API.");
    const uploadedFile = await uploadVideoFile(ai, downloadedVideo, {
      logger: context.logger,
      tool: context.tool,
      strategyRequested: config.strategyRequested,
      strategyAttempted: "uploaded_file",
      uploadFailureMessage: "Failed to upload the downloaded video to Gemini Files API.",
      processingFailureMessage: "Failed while waiting for Gemini to process the uploaded video file.",
      processingHeartbeatMessage: "Waiting for Gemini to process the uploaded full video file.",
      reportHeartbeat: (message) => reportProgress(context, 2, 6, message),
      abortSignal: context.abortSignal,
    });

    await reportProgress(context, 3, 6, "Estimating model budget for full-video analysis.");
    const fullPrompt = buildPrompt(params.analysisPrompt);
    const tokenBudget = await estimateTokenBudget(
      ai,
      {
        model: config.finalModel,
        uploadedFile,
        prompt: fullPrompt,
      },
      {
        logger: context.logger,
        tool: context.tool,
        strategyRequested: config.strategyRequested,
        strategyAttempted: "uploaded_file",
        failureMessage: "Failed to estimate the token budget for uploaded-file analysis.",
        abortSignal: context.abortSignal,
      }
    );

    const singlePassOption = await chooseSinglePassMediaOption(
      ai,
      {
        uploadedFile,
        prompt: fullPrompt,
        model: config.finalModel,
        strategyRequested: config.strategyRequested,
        strategyAttempted: "uploaded_file_single_pass",
      },
      context
    );

    const cacheInfo =
      config.preferCache && singlePassOption
        ? await maybeCreateCache(
            ai,
            {
              model: config.finalModel,
              uploadedFile,
              fps: singlePassOption.fps ?? 1,
              mediaResolution: singlePassOption.mediaResolution,
              displayName: config.metadata.title || path.basename(downloadedVideo.filePath),
            },
            {
              logger: context.logger,
              tool: context.tool,
              strategyRequested: config.strategyRequested,
              strategyAttempted: "uploaded_file_single_pass",
              failureMessage: "Failed to create a cache entry for the uploaded video.",
              abortSignal: context.abortSignal,
            }
          )
        : null;

    let singlePassFallbackReason: string | null = null;

    if (singlePassOption) {
      await reportProgress(context, 4, 6, "Running uploaded-file analysis in a single Gemini request.");

      try {
        const analysis = await generateStructuredJson(
          ai,
          {
            model: config.finalModel,
            prompt: fullPrompt,
            responseSchema: config.responseSchema,
            ...(cacheInfo
              ? { cachedContent: cacheInfo.name }
              : {
                  videoPart: buildVideoPart(
                    { kind: "uploaded_file", uploadedFile },
                    { fps: singlePassOption.fps, mediaResolution: singlePassOption.mediaResolution }
                  ),
                }),
          },
          {
            logger: context.logger,
            tool: context.tool,
            stage: "single_pass_generate",
            code: "LONG_VIDEO_SINGLE_PASS_FAILED",
            failureMessage: "Failed to analyze the uploaded long video in a single pass.",
            strategyRequested: config.strategyRequested,
            strategyAttempted: "uploaded_file_single_pass",
            inputMode: cacheInfo ? "cached_content" : "uploaded_file",
            responseMode: "schema_json",
            details: {
              cacheUsed: Boolean(cacheInfo),
              fps: singlePassOption.fps ?? null,
              mediaResolution: singlePassOption.mediaResolution ?? null,
            },
            timeoutMs: GENERATION_TIMEOUT_MS,
            abortSignal: context.abortSignal,
          }
        );

        const session = await createSession(config.sessionStore, {
          normalizedYoutubeUrl: config.normalizedYoutubeUrl,
          uploadedFile,
          cacheName: cacheInfo?.name,
          cacheModel: cacheInfo ? config.finalModel : undefined,
          cacheExpireTime: cacheInfo?.expireTime || undefined,
          fps: singlePassOption.fps,
          mediaResolution: singlePassOption.mediaResolution,
          durationSeconds: config.metadata.durationSeconds,
          title: config.metadata.title,
        });

        return buildLongVideoResult({
          input: params,
          normalizedYoutubeUrl: config.normalizedYoutubeUrl,
          metadata: config.metadata,
          strategyRequested: config.strategyRequested,
          strategyUsed: "uploaded_file_single_pass",
          fallbackReason: null,
          modelsUsed: { chunkModel: config.chunkModel, finalModel: config.finalModel },
          chunkPlan: null,
          tokenBudget,
          cacheUsed: Boolean(cacheInfo),
          sessionId: session.sessionId,
          cacheName: cacheInfo?.name || null,
          analysis,
        });
      } catch (error) {
        const diagnostic = asDiagnosticError(error, {
          tool: context.tool,
          code: "LONG_VIDEO_SINGLE_PASS_FAILED",
          stage: "single_pass_generate",
          message: "Failed to analyze the uploaded long video in a single pass.",
          strategyRequested: config.strategyRequested,
          strategyAttempted: "uploaded_file_single_pass",
        });

        if (diagnostic.code === "REQUEST_CANCELLED") {
          throw diagnostic;
        }

        singlePassFallbackReason = categorizeUploadedFileFallback(diagnostic);
        context.logger.warn("long_video.single_pass_fallback", {
          reason: singlePassFallbackReason,
          message: diagnostic.message,
          causeMessage: diagnostic.causeMessage,
        });
      }
    } else {
      singlePassFallbackReason = "single pass exceeded budget";
    }

    await reportProgress(context, 5, 6, "Planning the smallest possible chunk set for uploaded-file analysis.");
    const chunkPlanResult = await chooseAdaptiveChunkPlanForUploadedFile(
      ai,
      {
        uploadedFile,
        metadata: config.metadata,
        analysisPrompt: params.analysisPrompt,
        chunkModel: config.chunkModel,
        strategyRequested: config.strategyRequested,
      },
      context
    );

    const chunkedResult = await analyzeUploadedFileChunksViaSegmentUploads(
      ai,
      {
        normalizedYoutubeUrl: config.normalizedYoutubeUrl,
        metadata: config.metadata,
        chunkPlan: chunkPlanResult.chunkPlan,
        mediaOption: chunkPlanResult.mediaOption,
        analysisPrompt: params.analysisPrompt,
        chunkModel: config.chunkModel,
        finalModel: config.finalModel,
        responseSchema: config.responseSchema,
        strategyRequested: config.strategyRequested,
      },
      context
    );

    return buildLongVideoResult({
      input: params,
      normalizedYoutubeUrl: config.normalizedYoutubeUrl,
      metadata: config.metadata,
      strategyRequested: config.strategyRequested,
      strategyUsed: "uploaded_file_chunks",
      fallbackReason: singlePassFallbackReason,
      modelsUsed: { chunkModel: config.chunkModel, finalModel: config.finalModel },
      chunkPlan: chunkedResult.chunkPlan,
      tokenBudget,
      cacheUsed: Boolean(cacheInfo),
      sessionId: null,
      cacheName: cacheInfo?.name || null,
      analysis: chunkedResult.analysis,
    });
  } finally {
    if (downloadedVideo) {
      try {
        await fs.rm(downloadedVideo.tempDir, { recursive: true, force: true });
      } catch (error) {
        context.logger.warn("long_video.temp_dir_cleanup_failed", {
          tempDir: downloadedVideo.tempDir,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export async function analyzeLongVideo(
  ai: GoogleGenAI,
  sessionStore: AnalysisSessionStore,
  params: LongToolInput,
  context: AnalysisExecutionContext
): Promise<LongToolOutput> {
  const normalizedYoutubeUrl = normalizeYouTubeUrl(params.youtubeUrl);
  if (!normalizedYoutubeUrl) {
    throw new Error("youtubeUrl must be a valid YouTube video URL.");
  }

  const chunkModel = params.chunkModel || DEFAULT_LONG_VIDEO_CHUNK_MODEL;
  const finalModel = params.finalModel || DEFAULT_LONG_VIDEO_FINAL_MODEL;
  const strategy = params.strategy || "auto";
  const preferCache = params.preferCache !== false;
  const responseSchema = parseSchema(params.responseSchemaJson);

  await reportProgress(context, 0, 6, "Fetching YouTube metadata.");
  let metadata: YtDlpMetadata;
  try {
    metadata = await fetchLongVideoMetadata({
      youtubeUrl: params.youtubeUrl,
      normalizedYoutubeUrl,
      signal: context.abortSignal,
      timeoutMs: METADATA_TIMEOUT_MS,
    });
  } catch (error) {
    throw asDiagnosticError(error, {
      tool: context.tool,
      code: "YOUTUBE_METADATA_FETCH_FAILED",
      stage: "metadata",
      message: "Failed to fetch YouTube metadata for long-video analysis.",
      strategyRequested: strategy,
      strategyAttempted: strategy === "url_chunks" ? "url_chunks" : "uploaded_file",
    });
  }

  if (strategy === "url_chunks") {
    return runUrlChunkStrategy(
      ai,
      params,
      {
        normalizedYoutubeUrl,
        metadata,
        chunkModel,
        finalModel,
        responseSchema,
        strategyRequested: strategy,
        fallbackReason: "Explicit url_chunks strategy selected.",
      },
      context
    );
  }

  try {
    return await runUploadedFileStrategy(
      ai,
      params,
      {
        sessionStore,
        normalizedYoutubeUrl,
        metadata,
        chunkModel,
        finalModel,
        responseSchema,
        strategyRequested: strategy,
        preferCache,
      },
      context
    );
  } catch (error) {
    const uploadedFileError = asDiagnosticError(error, {
      tool: context.tool,
      code: "LONG_VIDEO_UPLOADED_FILE_FAILED",
      stage: "unknown",
      message: "Uploaded-file long-video analysis failed.",
      strategyRequested: strategy,
      strategyAttempted: "uploaded_file",
    });

    if (strategy !== "auto" || uploadedFileError.code === "REQUEST_CANCELLED") {
      throw uploadedFileError;
    }

    const fallbackReason = categorizeUploadedFileFallback(uploadedFileError);
    context.logger.warn("long_video.auto_fallback_to_url_chunks", {
      reason: fallbackReason,
      code: uploadedFileError.code,
      stage: uploadedFileError.stage,
      message: uploadedFileError.message,
      causeMessage: uploadedFileError.causeMessage,
      details: uploadedFileError.details,
    });

    return runUrlChunkStrategy(
      ai,
      params,
      {
        normalizedYoutubeUrl,
        metadata,
        chunkModel,
        finalModel,
        responseSchema,
        strategyRequested: strategy,
        fallbackReason,
      },
      context
    );
  }
}

export async function continueLongVideoAnalysis(
  ai: GoogleGenAI,
  sessionStore: AnalysisSessionStore,
  params: FollowUpToolInput,
  context: AnalysisExecutionContext
): Promise<FollowUpToolOutput> {
  const session = await sessionStore.get(params.sessionId);
  if (!session) {
    throw new Error("Unknown analysis session. The session may have expired or the backing store may not contain it.");
  }

  const targetModel = params.model || session.cacheModel || DEFAULT_LONG_VIDEO_FINAL_MODEL;
  const cacheUsed = Boolean(session.cacheName && session.cacheModel === targetModel);

  await reportProgress(context, 1, 1, "Continuing long-video analysis from the existing session.");
  const analysis = await generateStructuredJson(
    ai,
    {
      model: targetModel,
      prompt: buildFollowUpPrompt(params.analysisPrompt),
      responseSchema: parseSchema(params.responseSchemaJson),
      ...(cacheUsed
        ? { cachedContent: session.cacheName }
        : {
            videoPart: buildVideoPart(
              { kind: "uploaded_file", uploadedFile: session.uploadedFile },
              { fps: session.fps, mediaResolution: session.mediaResolution }
            ),
          }),
    },
    {
      logger: context.logger,
      tool: context.tool,
      stage: "follow_up_generate",
      code: "FOLLOW_UP_ANALYSIS_FAILED",
      failureMessage: "Failed to continue the long-video analysis session.",
      strategyAttempted: cacheUsed ? "cached_follow_up" : "uploaded_file_follow_up",
      inputMode: cacheUsed ? "cached_content" : "uploaded_file",
      responseMode: "schema_json",
      details: { sessionId: session.sessionId, cacheUsed },
      timeoutMs: GENERATION_TIMEOUT_MS,
      abortSignal: context.abortSignal,
    }
  );

  return {
    sessionId: session.sessionId,
    normalizedYoutubeUrl: session.normalizedYoutubeUrl,
    cacheUsed,
    model: targetModel,
    usedCustomSchema: Boolean(params.responseSchemaJson),
    analysis,
  };
}



