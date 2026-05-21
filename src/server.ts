import { InMemoryTaskMessageQueue } from "@modelcontextprotocol/sdk/experimental";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, GetTaskResult, Task } from "@modelcontextprotocol/sdk/types.js";

import { createVideoAnalysisService, ManagedTaskStore } from "./platform-runtime/index.js";
import {
  DEFAULT_TASK_TTL_MS,
  MCP_TOOL_DEADLINE_MS,
  SERVER_INFO,
  DiagnosticError,
  asDiagnosticError,
  cancelLongAnalysisJobOutputSchema,
  audioToolInputSchema,
  audioToolOutputSchema,
  capabilitiesToolInputSchema,
  capabilitiesToolOutputSchema,
  createRequestLogger,
  followUpToolInputSchema,
  followUpToolOutputSchema,
  frameToolInputSchema,
  frameToolOutputSchema,
  formatJson,
  longAnalysisJobIdInputSchema,
  longAnalysisJobResultOutputSchema,
  longAnalysisJobStatusOutputSchema,
  longAnalysisJobInputSchema,
  longToolInputSchema,
  longToolOutputSchema,
  metadataToolInputSchema,
  metadataToolOutputSchema,
  shortToolInputSchema,
  shortToolOutputSchema,
  startLongAnalysisJobOutputSchema,
  type AnalysisExecutionContext,
  type CancelLongAnalysisJobOutput,
  type CapabilitiesToolOutput,
  type FollowUpToolInput,
  type FollowUpToolOutput,
  type FrameToolOutput,
  type LongAnalysisJobResultOutput,
  type LongAnalysisJobStatusOutput,
  type Logger,
  type LongToolInput,
  type LongToolOutput,
  type ProgressReporter,
  type StartLongAnalysisJobOutput,
  type VideoAnalysisServiceLike,
} from "@ludylops/video-analysis-core";
import { getLongVideoRuntimeCapabilities, type LongVideoRuntimeCapabilities } from "@ludylops/video-analysis-core/youtube/runtime";
import { LongAnalysisJobStore, type LongAnalysisJob, type LongAnalysisJobError } from "./long-analysis-job-store.js";

type StructuredSuccess = Record<string, unknown>;

type RequestExtra = {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  requestId: string | number;
  taskId?: string;
  taskRequestedTtl?: number | null;
  sendNotification: (notification: {
    method: string;
    params?: Record<string, unknown>;
  }) => Promise<void>;
  taskStore?: {
    createTask: (params: { ttl?: number | null; pollInterval?: number; context?: Record<string, unknown> }) => Promise<Task>;
    getTask: (taskId: string) => Promise<GetTaskResult>;
    getTaskResult: (taskId: string) => Promise<CallToolResult>;
  };
};

type TaskCreateExtra = RequestExtra & {
  taskStore: NonNullable<RequestExtra["taskStore"]>;
};

export type CreateServerOptions = {
  service?: VideoAnalysisServiceLike;
  taskStore?: ManagedTaskStore;
  longAnalysisJobStore?: LongAnalysisJobStore;
  capabilitiesProvider?: () => Promise<LongVideoRuntimeCapabilities>;
  deadlines?: {
    toolMs?: number;
  };
};

function createSuccessToolResult(structuredContent: StructuredSuccess) {
  return {
    content: [{ type: "text" as const, text: formatJson(structuredContent) }],
    structuredContent,
  };
}

function createImageToolResult(structuredContent: FrameToolOutput) {
  return {
    content: [
      { type: "text" as const, text: formatJson(structuredContent) },
      { type: "image" as const, data: structuredContent.jpegBase64, mimeType: structuredContent.mimeType },
    ],
    structuredContent,
  };
}

function createErrorToolResult(toolName: string, requestId: string, error: unknown) {
  const diagnostic = asDiagnosticError(error, {
    tool: toolName,
    code: "TOOL_EXECUTION_FAILED",
    stage: "unknown",
    message: "Tool execution failed.",
  });

  const structuredContent = {
    error: {
      tool: toolName,
      requestId,
      code: diagnostic.code,
      stage: diagnostic.stage,
      message: diagnostic.message,
      retryable: diagnostic.retryable,
      strategyRequested: diagnostic.strategyRequested ?? null,
      strategyAttempted: diagnostic.strategyAttempted ?? null,
      causeMessage: diagnostic.causeMessage ?? null,
      details: diagnostic.details ?? null,
    },
  };

  return {
    isError: true as const,
    content: [{ type: "text" as const, text: formatJson(structuredContent) }],
  };
}

function linkAbortSignal(source: AbortSignal | undefined, controller: AbortController): void {
  if (!source) {
    return;
  }

  if (source.aborted) {
    controller.abort(source.reason);
    return;
  }

  source.addEventListener("abort", () => controller.abort(source.reason), { once: true });
}

function createDeadlineController(source: AbortSignal | undefined, timeoutMs: number, message: string): AbortController {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromSource = () => {
    controller.abort(source?.reason ?? "Request aborted.");
  };

  if (source?.aborted) {
    abortFromSource();
  } else {
    source?.addEventListener("abort", abortFromSource, { once: true });
    timeoutId = setTimeout(() => controller.abort(message), timeoutMs);
    timeoutId.unref?.();
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      source?.removeEventListener("abort", abortFromSource);
    },
    { once: true }
  );

  return controller;
}

async function runWithDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, params: {
  toolName: string;
  sourceSignal?: AbortSignal;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<T> {
  const controller = createDeadlineController(params.sourceSignal, params.timeoutMs, params.timeoutMessage);

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        const rejectForAbort = () => {
          const message = String(controller.signal.reason ?? params.timeoutMessage);
          reject(
            new DiagnosticError({
              tool: params.toolName,
              code: sourceSignalAborted(params.sourceSignal) ? "REQUEST_CANCELLED" : "MCP_TOOL_DEADLINE_EXCEEDED",
              stage: "unknown",
              message,
              retryable: sourceSignalAborted(params.sourceSignal),
              details: { timeoutMs: params.timeoutMs },
            })
          );
        };

        if (controller.signal.aborted) {
          rejectForAbort();
          return;
        }

        controller.signal.addEventListener("abort", rejectForAbort, { once: true });
      }),
    ]);
  } finally {
    if (!controller.signal.aborted) {
      controller.abort("Request completed.");
    }
  }
}

function sourceSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function createCapabilitiesOutput(capabilities: LongVideoRuntimeCapabilities, mcpToolDeadlineMs: number): CapabilitiesToolOutput {
  const hasUploadedFileSupport = capabilities.ytDlpAvailable && capabilities.ffmpegAvailable && capabilities.tempDirWritable;
  const recommendedLongVideoStrategy = hasUploadedFileSupport ? "uploaded_file" : "url_chunks";

  return {
    transport: "stdio",
    mcpToolDeadlineMs,
    supportsMcpTasks: true,
    ytDlpAvailable: capabilities.ytDlpAvailable,
    ffmpegAvailable: capabilities.ffmpegAvailable,
    tempDirWritable: capabilities.tempDirWritable,
    ytDlpCommand: capabilities.ytDlpCommand,
    recommendedLongVideoStrategy,
    recommendedWorkflow: [
      "Use get_youtube_analyzer_capabilities before long VOD analysis.",
      "Use analyze_youtube_video for short videos or bounded clips.",
      "Use get_youtube_video_frame to extract a high-resolution JPEG frame at a timestamp when yt-dlp, ffmpeg, and temp dir support are available.",
      "Use analyze_long_youtube_video for VODs and long videos; this server requires MCP task execution for it.",
      hasUploadedFileSupport
        ? "For long videos, prefer strategy=uploaded_file or strategy=auto."
        : "For long videos, use strategy=url_chunks until yt-dlp and ffmpeg are available.",
      "Use continue_long_video_analysis only with a sessionId returned by analyze_long_youtube_video.",
    ],
    notes: [
      "timeoutSeconds controls internal Gemini generation calls, not the MCP client's outer timeout.",
      "Clients with fixed synchronous tool-call timeouts, such as 120s, should use task execution, the start/get/cancel job tools, or bounded clips instead.",
      "uploaded_file requires yt-dlp, ffmpeg, and a writable temp directory.",
      "get_youtube_video_frame requires yt-dlp, ffmpeg, and a writable temp directory.",
      "url_chunks does not require local download tools, but can require many Gemini calls for long VODs.",
    ],
  };
}

function createProgressReporter(extra: RequestExtra, logger: Logger): ProgressReporter {
  let lastProgress = Number.NEGATIVE_INFINITY;

  return async ({ progress, total, message }) => {
    if (extra._meta?.progressToken === undefined) {
      return;
    }

    if (progress <= lastProgress) {
      logger.warn("tool.progress_notification_skipped", {
        progress,
        lastProgress,
        total: total ?? null,
        message,
        taskId: extra.taskId ?? null,
        reason: "non_monotonic_progress",
      });
      return;
    }

    lastProgress = progress;
    logger.info("tool.progress_notification", { progress, total: total ?? null, message, taskId: extra.taskId ?? null });
    await extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken: extra._meta.progressToken,
        progress,
        ...(total !== undefined ? { total } : {}),
        message,
      },
    });
  };
}

function createJobProgressReporter(jobStore: LongAnalysisJobStore, jobId: string, logger: Logger): ProgressReporter {
  let lastProgress = Number.NEGATIVE_INFINITY;

  return async (update) => {
    if (update.progress <= lastProgress) {
      logger.warn("job.progress_skipped", {
        jobId,
        progress: update.progress,
        lastProgress,
        total: update.total ?? null,
        message: update.message,
        reason: "non_monotonic_progress",
      });
      return;
    }

    lastProgress = update.progress;
    logger.info("job.progress", {
      jobId,
      progress: update.progress,
      total: update.total ?? null,
      message: update.message,
    });
    jobStore.updateProgress(jobId, update);
  };
}

function toJobError(error: unknown, toolName: string): LongAnalysisJobError {
  const diagnostic = asDiagnosticError(error, {
    tool: toolName,
    code: "LONG_ANALYSIS_JOB_FAILED",
    stage: "unknown",
    message: "Long-video analysis job failed.",
  });

  return {
    code: diagnostic.code,
    stage: diagnostic.stage,
    message: diagnostic.message,
    retryable: diagnostic.retryable,
    causeMessage: diagnostic.causeMessage ?? null,
    details: diagnostic.details ?? null,
  };
}

function createJobNotFoundError(toolName: string, jobId: string): DiagnosticError {
  return new DiagnosticError({
    tool: toolName,
    code: "LONG_ANALYSIS_JOB_NOT_FOUND",
    stage: "unknown",
    message: `Long-video analysis job not found: ${jobId}.`,
    retryable: false,
  });
}

function createJobStatusOutput(job: LongAnalysisJob): LongAnalysisJobStatusOutput {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    statusMessage: job.statusMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function createJobResultOutput(job: LongAnalysisJob): LongAnalysisJobResultOutput {
  return {
    jobId: job.jobId,
    status: job.status,
    result: job.result,
    error: job.error,
    statusMessage: job.statusMessage,
  };
}

function createCancelJobOutput(job: LongAnalysisJob): CancelLongAnalysisJobOutput {
  const status = job.status === "done" || job.status === "error" ? job.status : "cancelled";
  return {
    jobId: job.jobId,
    status,
    statusMessage: job.statusMessage,
  };
}

function createExecutionContext(tool: string, logger: Logger, signal: AbortSignal, reportProgress?: ProgressReporter): AnalysisExecutionContext {
  return { logger, tool, abortSignal: signal, reportProgress };
}

async function finalizeCancelledTask(taskStore: ManagedTaskStore, taskId: string, message: string): Promise<void> {
  try {
    await taskStore.updateTaskStatus(taskId, "cancelled", message);
  } catch {
    // Ignore terminal-state races.
  }
}

async function runLongTask<Args, Result extends StructuredSuccess>(params: {
  toolName: string;
  taskStore: ManagedTaskStore;
  extra: TaskCreateExtra;
  args: Args;
  logger: Logger;
  startedAt: number;
  execute: (args: Args, context: AnalysisExecutionContext) => Promise<Result>;
  onSuccessLog: (result: Result) => Record<string, unknown>;
  onStartLog: Record<string, unknown>;
}): Promise<{ task: Task }> {
  const task = await params.extra.taskStore.createTask({ ttl: params.extra.taskRequestedTtl ?? DEFAULT_TASK_TTL_MS });
  const controller = new AbortController();
  linkAbortSignal(params.extra.signal, controller);
  params.taskStore.registerAbortController(task.taskId, controller);

  params.logger.info("tool.start", { ...params.onStartLog, taskId: task.taskId });

  const progressReporter = createProgressReporter({ ...params.extra, taskId: task.taskId }, params.logger);

  void (async () => {
    try {
      const result = await params.execute(
        params.args,
        createExecutionContext(params.toolName, params.logger, controller.signal, progressReporter)
      );

      if (controller.signal.aborted) {
        await finalizeCancelledTask(params.taskStore, task.taskId, "Task cancelled.");
        return;
      }

      params.logger.info("tool.success", {
        durationMs: Date.now() - params.startedAt,
        taskId: task.taskId,
        ...params.onSuccessLog(result),
      });
      await params.taskStore.storeTaskResult(task.taskId, "completed", createSuccessToolResult(result));
    } catch (error) {
      const diagnostic = asDiagnosticError(error, {
        tool: params.toolName,
        code: "TOOL_EXECUTION_FAILED",
        stage: "unknown",
        message: "Tool execution failed.",
      });

      if (controller.signal.aborted || diagnostic.code === "REQUEST_CANCELLED") {
        await finalizeCancelledTask(params.taskStore, task.taskId, diagnostic.message);
        return;
      }

      params.logger.error("tool.failure", {
        durationMs: Date.now() - params.startedAt,
        taskId: task.taskId,
        code: diagnostic.code,
        stage: diagnostic.stage,
        message: diagnostic.message,
        retryable: diagnostic.retryable,
        causeMessage: diagnostic.causeMessage,
        details: diagnostic.details,
      });
      await params.taskStore.storeTaskResult(
        task.taskId,
        "failed",
        createErrorToolResult(params.toolName, params.logger.requestId, diagnostic)
      );
    } finally {
      params.taskStore.releaseAbortController(task.taskId);
    }
  })();

  return { task };
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const taskStore = options.taskStore ?? new ManagedTaskStore();
  const longAnalysisJobStore = options.longAnalysisJobStore ?? new LongAnalysisJobStore();
  const service = options.service ?? createVideoAnalysisService();
  const capabilitiesProvider = options.capabilitiesProvider ?? (() => getLongVideoRuntimeCapabilities("uploaded_file"));
  const deadlines = {
    toolMs: options.deadlines?.toolMs ?? MCP_TOOL_DEADLINE_MS,
  };
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      logging: {},
      tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
    },
    taskStore,
    taskMessageQueue: new InMemoryTaskMessageQueue(),
  });

  server.registerTool(
    "get_youtube_analyzer_capabilities",
    {
      title: "Get YouTube Analyzer Capabilities",
      description: [
        "Inspect this stdio MCP server's local runtime capabilities before choosing a long-video strategy.",
        "Call this before analyzing VODs or long videos.",
        "If ytDlpAvailable, ffmpegAvailable, and tempDirWritable are all true, use analyze_long_youtube_video with strategy=auto or uploaded_file.",
        "If any of those are false, use strategy=url_chunks for long videos or analyze shorter clips with analyze_youtube_video.",
      ].join(" "),
      inputSchema: capabilitiesToolInputSchema,
      outputSchema: capabilitiesToolOutputSchema,
    },
    async () => {
      const logger = createRequestLogger("get_youtube_analyzer_capabilities");
      const startedAt = Date.now();
      logger.info("tool.start", {});

      try {
        const result = createCapabilitiesOutput(await capabilitiesProvider(), deadlines.toolMs);
        logger.info("tool.success", {
          durationMs: Date.now() - startedAt,
          ytDlpAvailable: result.ytDlpAvailable,
          ffmpegAvailable: result.ffmpegAvailable,
          tempDirWritable: result.tempDirWritable,
          recommendedLongVideoStrategy: result.recommendedLongVideoStrategy,
        });
        return createSuccessToolResult(result);
      } catch (error) {
        const diagnostic = asDiagnosticError(error, {
          tool: "get_youtube_analyzer_capabilities",
          code: "CAPABILITY_CHECK_FAILED",
          stage: "config",
          message: "Failed to inspect local YouTube analyzer capabilities.",
        });
        logger.error("tool.failure", {
          durationMs: Date.now() - startedAt,
          code: diagnostic.code,
          stage: diagnostic.stage,
          message: diagnostic.message,
          retryable: diagnostic.retryable,
          causeMessage: diagnostic.causeMessage,
          details: diagnostic.details,
        });
        return createErrorToolResult("get_youtube_analyzer_capabilities", logger.requestId, diagnostic);
      }
    }
  );

  server.registerTool(
    "get_youtube_video_metadata",
    {
      title: "Get YouTube Video Metadata",
      description: [
        "Fetch normalized public YouTube video metadata with the YouTube Data API.",
        "Accepts supported YouTube URL formats, normalizes them to a canonical watch URL, and does not use Gemini or download the video.",
      ].join(" "),
      inputSchema: metadataToolInputSchema,
      outputSchema: metadataToolOutputSchema,
    },
    async ({ youtubeUrl }, extra) => {
      const logger = createRequestLogger("get_youtube_video_metadata");
      const startedAt = Date.now();
      logger.info("tool.start", { youtubeUrl });

      try {
        const result = await runWithDeadline(
          (signal) =>
            service.getYouTubeMetadata(
              { youtubeUrl },
              createExecutionContext("get_youtube_video_metadata", logger, signal)
            ),
          {
            toolName: "get_youtube_video_metadata",
            sourceSignal: extra.signal,
            timeoutMs: deadlines.toolMs,
            timeoutMessage: `MCP tool deadline exceeded after ${deadlines.toolMs}ms.`,
          }
        );

        logger.info("tool.success", {
          durationMs: Date.now() - startedAt,
          videoId: result.videoId,
        });
        return createSuccessToolResult(result);
      } catch (error) {
        const diagnostic = asDiagnosticError(error, {
          tool: "get_youtube_video_metadata",
          code: "YOUTUBE_METADATA_FETCH_FAILED",
          stage: "metadata",
          message: "YouTube metadata fetch failed.",
        });
        logger.error("tool.failure", {
          durationMs: Date.now() - startedAt,
          code: diagnostic.code,
          stage: diagnostic.stage,
          message: diagnostic.message,
          retryable: diagnostic.retryable,
          causeMessage: diagnostic.causeMessage,
          details: diagnostic.details,
        });
        return createErrorToolResult("get_youtube_video_metadata", logger.requestId, diagnostic);
      }
    }
  );

  server.registerTool(
    "get_youtube_video_frame",
    {
      title: "Get YouTube Video Frame",
      description: [
        "Extract a high-resolution JPEG frame from a public YouTube video at a timestamp.",
        "Uses yt-dlp to download a small best-quality video window around the timestamp and ffmpeg to extract one JPEG frame without downscaling.",
        "Returns the JPEG as base64 structured content and as an MCP image content item.",
      ].join(" "),
      inputSchema: frameToolInputSchema,
      outputSchema: frameToolOutputSchema,
    },
    async ({ youtubeUrl, timestampSeconds, jpegQuality, searchWindowSeconds }, extra) => {
      const logger = createRequestLogger("get_youtube_video_frame");
      const startedAt = Date.now();
      logger.info("tool.start", {
        youtubeUrl,
        timestampSeconds,
        jpegQuality: jpegQuality ?? null,
        searchWindowSeconds: searchWindowSeconds ?? null,
      });

      try {
        const result = await runWithDeadline(
          (signal) =>
            service.getYouTubeFrame(
              { youtubeUrl, timestampSeconds, jpegQuality, searchWindowSeconds },
              createExecutionContext("get_youtube_video_frame", logger, signal)
            ),
          {
            toolName: "get_youtube_video_frame",
            sourceSignal: extra.signal,
            timeoutMs: deadlines.toolMs,
            timeoutMessage: `MCP tool deadline exceeded after ${deadlines.toolMs}ms.`,
          }
        );

        logger.info("tool.success", {
          durationMs: Date.now() - startedAt,
          timestampSeconds: result.timestampSeconds,
          sizeBytes: result.sizeBytes,
        });
        return createImageToolResult(result);
      } catch (error) {
        const diagnostic = asDiagnosticError(error, {
          tool: "get_youtube_video_frame",
          code: "YOUTUBE_FRAME_EXTRACTION_FAILED",
          stage: "download",
          message: "YouTube frame extraction failed.",
        });
        logger.error("tool.failure", {
          durationMs: Date.now() - startedAt,
          code: diagnostic.code,
          stage: diagnostic.stage,
          message: diagnostic.message,
          retryable: diagnostic.retryable,
          causeMessage: diagnostic.causeMessage,
          details: diagnostic.details,
        });
        return createErrorToolResult("get_youtube_video_frame", logger.requestId, diagnostic);
      }
    }
  );

  server.registerTool(
    "analyze_youtube_video",
    {
      title: "Analyze YouTube Video",
      description: [
        "Analyze a public YouTube video with Google Gemini.",
        "The YouTube URL is normalized to a canonical watch URL, then sent as video input with optional clip offsets attached through videoMetadata.",
        "Detects the dominant language of the video, returns natural-language fields in that language, and accepts an optional custom JSON schema.",
        "Use this for short videos or bounded clip windows. For VODs and long videos, call get_youtube_analyzer_capabilities first and then use analyze_long_youtube_video.",
      ].join(" "),
      inputSchema: shortToolInputSchema,
      outputSchema: shortToolOutputSchema,
    },
    async ({ youtubeUrl, analysisPrompt, startOffsetSeconds, endOffsetSeconds, model, responseSchemaJson }, extra) => {
      const logger = createRequestLogger("analyze_youtube_video");
      const startedAt = Date.now();
      logger.info("tool.start", {
        youtubeUrl,
        startOffsetSeconds: startOffsetSeconds ?? null,
        endOffsetSeconds: endOffsetSeconds ?? null,
        model: model ?? null,
      });

      try {
        const result = await runWithDeadline(
          (signal) =>
            service.analyzeShort(
              { youtubeUrl, analysisPrompt, startOffsetSeconds, endOffsetSeconds, model, responseSchemaJson },
              createExecutionContext("analyze_youtube_video", logger, signal)
            ),
          {
            toolName: "analyze_youtube_video",
            sourceSignal: extra.signal,
            timeoutMs: deadlines.toolMs,
            timeoutMessage: `MCP tool deadline exceeded after ${deadlines.toolMs}ms.`,
          }
        );

        logger.info("tool.success", {
          durationMs: Date.now() - startedAt,
          model: result.model,
        });
        return createSuccessToolResult(result);
      } catch (error) {
        const diagnostic = asDiagnosticError(error, {
          tool: "analyze_youtube_video",
          code: "SHORT_VIDEO_ANALYSIS_FAILED",
          stage: "unknown",
          message: "Short-video analysis failed.",
        });
        logger.error("tool.failure", {
          durationMs: Date.now() - startedAt,
          code: diagnostic.code,
          stage: diagnostic.stage,
          message: diagnostic.message,
          retryable: diagnostic.retryable,
          causeMessage: diagnostic.causeMessage,
          details: diagnostic.details,
        });
        return createErrorToolResult("analyze_youtube_video", logger.requestId, diagnostic);
      }
    }
  );

  server.registerTool(
    "analyze_youtube_video_audio",
    {
      title: "Analyze YouTube Video From Audio",
      description: [
        "Analyze a public YouTube video using only the audio track and transcript-like understanding from Gemini.",
        "The YouTube URL is normalized to a canonical watch URL and sent as media input, but the prompt explicitly ignores visual-only evidence and focuses on spoken content, audible cues, and timestamped transcript excerpts.",
        "Use this for speech-focused short videos or bounded clip windows, not full long VODs.",
      ].join(" "),
      inputSchema: audioToolInputSchema,
      outputSchema: audioToolOutputSchema,
    },
    async ({ youtubeUrl, analysisPrompt, startOffsetSeconds, endOffsetSeconds, model, responseSchemaJson }, extra) => {
      const logger = createRequestLogger("analyze_youtube_video_audio");
      const startedAt = Date.now();
      logger.info("tool.start", {
        youtubeUrl,
        startOffsetSeconds: startOffsetSeconds ?? null,
        endOffsetSeconds: endOffsetSeconds ?? null,
        model: model ?? null,
      });

      try {
        const result = await runWithDeadline(
          (signal) =>
            service.analyzeAudio(
              { youtubeUrl, analysisPrompt, startOffsetSeconds, endOffsetSeconds, model, responseSchemaJson },
              createExecutionContext("analyze_youtube_video_audio", logger, signal)
            ),
          {
            toolName: "analyze_youtube_video_audio",
            sourceSignal: extra.signal,
            timeoutMs: deadlines.toolMs,
            timeoutMessage: `MCP tool deadline exceeded after ${deadlines.toolMs}ms.`,
          }
        );

        logger.info("tool.success", {
          durationMs: Date.now() - startedAt,
          model: result.model,
        });
        return createSuccessToolResult(result);
      } catch (error) {
        const diagnostic = asDiagnosticError(error, {
          tool: "analyze_youtube_video_audio",
          code: "AUDIO_ONLY_VIDEO_ANALYSIS_FAILED",
          stage: "unknown",
          message: "Audio-only video analysis failed.",
        });
        logger.error("tool.failure", {
          durationMs: Date.now() - startedAt,
          code: diagnostic.code,
          stage: diagnostic.stage,
          message: diagnostic.message,
          retryable: diagnostic.retryable,
          causeMessage: diagnostic.causeMessage,
          details: diagnostic.details,
        });
        return createErrorToolResult("analyze_youtube_video_audio", logger.requestId, diagnostic);
      }
    }
  );

  server.registerTool(
    "start_long_youtube_analysis",
    {
      title: "Start Long YouTube Analysis Job",
      description: [
        "Starts long public YouTube video or VOD analysis as a server-managed background job and returns immediately.",
        "Use this compatibility tool when your MCP client does not support MCP tasks or has a fixed synchronous tool-call timeout such as 120s.",
        "Poll get_long_youtube_analysis_status, fetch the final output with get_long_youtube_analysis_result, and cancel with cancel_long_youtube_analysis.",
        "Call get_youtube_analyzer_capabilities first to choose the strategy.",
      ].join(" "),
      inputSchema: longAnalysisJobInputSchema,
      outputSchema: startLongAnalysisJobOutputSchema,
    },
    async (args) => {
      const input = args as LongToolInput;
      const logger = createRequestLogger("start_long_youtube_analysis");
      const startedAt = Date.now();
      logger.info("tool.start", {
        youtubeUrl: input.youtubeUrl,
        strategyRequested: input.strategy ?? "auto",
        chunkModel: input.chunkModel ?? null,
        finalModel: input.finalModel ?? null,
        preferCache: input.preferCache ?? null,
        timeoutSeconds: input.timeoutSeconds ?? null,
        maxChunkDurationSeconds: input.maxChunkDurationSeconds ?? null,
        maxRetries: input.maxRetries ?? null,
      });

      try {
        const job = longAnalysisJobStore.createJob(input, DEFAULT_TASK_TTL_MS);
        const output: StartLongAnalysisJobOutput = {
          jobId: job.jobId,
          status: "queued",
          statusMessage: "Long-video analysis job queued.",
        };

        void Promise.resolve().then(async () => {
          longAnalysisJobStore.markRunning(job.jobId);
          logger.info("job.start", { jobId: job.jobId });

          try {
            const currentJob = longAnalysisJobStore.getJob(job.jobId);
            if (!currentJob || currentJob.controller.signal.aborted) {
              return;
            }

            const result = await service.analyzeLong(
              input,
              createExecutionContext(
                "start_long_youtube_analysis",
                logger,
                currentJob.controller.signal,
                createJobProgressReporter(longAnalysisJobStore, job.jobId, logger)
              )
            );

            if (currentJob.controller.signal.aborted) {
              longAnalysisJobStore.cancelJob(job.jobId, "Long-video analysis job cancelled.");
              return;
            }

            longAnalysisJobStore.completeJob(job.jobId, result);
            logger.info("job.success", {
              durationMs: Date.now() - startedAt,
              jobId: job.jobId,
              strategyRequested: result.strategyRequested,
              strategyUsed: result.strategyUsed,
              chunkCount: result.chunkCount,
              cacheUsed: result.cacheUsed,
              sessionId: result.sessionId,
            });
          } catch (error) {
            const currentJob = longAnalysisJobStore.getJob(job.jobId);
            if (currentJob?.controller.signal.aborted) {
              longAnalysisJobStore.cancelJob(job.jobId, "Long-video analysis job cancelled.");
              return;
            }

            const jobError = toJobError(error, "start_long_youtube_analysis");
            longAnalysisJobStore.failJob(job.jobId, jobError);
            logger.error("job.failure", {
              durationMs: Date.now() - startedAt,
              jobId: job.jobId,
              ...jobError,
            });
          }
        });

        logger.info("tool.success", { durationMs: Date.now() - startedAt, jobId: job.jobId });
        return createSuccessToolResult(output);
      } catch (error) {
        const diagnostic = asDiagnosticError(error, {
          tool: "start_long_youtube_analysis",
          code: "LONG_ANALYSIS_JOB_START_FAILED",
          stage: "unknown",
          message: "Failed to start long-video analysis job.",
        });
        logger.error("tool.failure", {
          durationMs: Date.now() - startedAt,
          code: diagnostic.code,
          stage: diagnostic.stage,
          message: diagnostic.message,
          retryable: diagnostic.retryable,
          causeMessage: diagnostic.causeMessage,
          details: diagnostic.details,
        });
        return createErrorToolResult("start_long_youtube_analysis", logger.requestId, diagnostic);
      }
    }
  );

  server.registerTool(
    "get_long_youtube_analysis_status",
    {
      title: "Get Long YouTube Analysis Job Status",
      description: "Returns the status and latest progress for a job created by start_long_youtube_analysis.",
      inputSchema: longAnalysisJobIdInputSchema,
      outputSchema: longAnalysisJobStatusOutputSchema,
    },
    async ({ jobId }) => {
      const logger = createRequestLogger("get_long_youtube_analysis_status");
      logger.info("tool.start", { jobId });

      const job = longAnalysisJobStore.getJob(jobId);
      if (!job) {
        return createErrorToolResult("get_long_youtube_analysis_status", logger.requestId, createJobNotFoundError("get_long_youtube_analysis_status", jobId));
      }

      logger.info("tool.success", { jobId, status: job.status });
      return createSuccessToolResult(createJobStatusOutput(job));
    }
  );

  server.registerTool(
    "get_long_youtube_analysis_result",
    {
      title: "Get Long YouTube Analysis Job Result",
      description: [
        "Returns the final result for a job created by start_long_youtube_analysis.",
        "While the job is queued or running, result and error are null and status indicates that the job is not done yet.",
      ].join(" "),
      inputSchema: longAnalysisJobIdInputSchema,
      outputSchema: longAnalysisJobResultOutputSchema,
    },
    async ({ jobId }) => {
      const logger = createRequestLogger("get_long_youtube_analysis_result");
      logger.info("tool.start", { jobId });

      const job = longAnalysisJobStore.getJob(jobId);
      if (!job) {
        return createErrorToolResult("get_long_youtube_analysis_result", logger.requestId, createJobNotFoundError("get_long_youtube_analysis_result", jobId));
      }

      logger.info("tool.success", { jobId, status: job.status });
      return createSuccessToolResult(createJobResultOutput(job));
    }
  );

  server.registerTool(
    "cancel_long_youtube_analysis",
    {
      title: "Cancel Long YouTube Analysis Job",
      description: "Cancels a queued or running job created by start_long_youtube_analysis.",
      inputSchema: longAnalysisJobIdInputSchema,
      outputSchema: cancelLongAnalysisJobOutputSchema,
    },
    async ({ jobId }) => {
      const logger = createRequestLogger("cancel_long_youtube_analysis");
      logger.info("tool.start", { jobId });

      const job = longAnalysisJobStore.cancelJob(jobId);
      if (!job) {
        return createErrorToolResult("cancel_long_youtube_analysis", logger.requestId, createJobNotFoundError("cancel_long_youtube_analysis", jobId));
      }

      logger.info("tool.success", { jobId, status: job.status });
      return createSuccessToolResult(createCancelJobOutput(job));
    }
  );

  server.experimental.tasks.registerToolTask<typeof longToolInputSchema, typeof longToolOutputSchema>(
      "analyze_long_youtube_video",
      {
        title: "Analyze Long YouTube Video",
        description: [
          "Analyze a long public YouTube video with Gemini long-video handling.",
          "Call get_youtube_analyzer_capabilities first to choose the strategy.",
          "This stdio server requires MCP task execution for this tool.",
          "Clients with fixed synchronous tool-call timeouts, such as 120s, should not call this tool unless they support MCP tasks.",
          "Auto mode prefers uploaded-file analysis first because Files API is the recommended path for long videos, and falls back to URL chunks when needed.",
          "uploaded_file requires yt-dlp, ffmpeg, and a writable temp directory.",
          "Use strategy=url_chunks when local download tools are unavailable; it avoids yt-dlp but can require many Gemini calls.",
          "Do not use timeoutSeconds to bypass MCP client limits; it only controls internal Gemini generation calls.",
        ].join(" "),
        inputSchema: longToolInputSchema,
        outputSchema: longToolOutputSchema,
        execution: { taskSupport: "required" },
      },
      {
        async createTask(args, extra) {
          const typedArgs = args as LongToolInput;
          const logger = createRequestLogger("analyze_long_youtube_video");
          const startedAt = Date.now();

          return runLongTask<LongToolInput, LongToolOutput>({
            toolName: "analyze_long_youtube_video",
            taskStore,
            extra: extra as unknown as TaskCreateExtra,
            args: typedArgs,
            logger,
            startedAt,
            execute: (input, context) => service.analyzeLong(input, context),
            onStartLog: {
              youtubeUrl: typedArgs.youtubeUrl,
              strategyRequested: typedArgs.strategy ?? "auto",
              chunkModel: typedArgs.chunkModel ?? null,
              finalModel: typedArgs.finalModel ?? null,
              preferCache: typedArgs.preferCache ?? null,
              timeoutSeconds: typedArgs.timeoutSeconds ?? null,
              maxChunkDurationSeconds: typedArgs.maxChunkDurationSeconds ?? null,
              maxRetries: typedArgs.maxRetries ?? null,
            },
            onSuccessLog: (result) => ({
              strategyRequested: result.strategyRequested,
              strategyUsed: result.strategyUsed,
              chunkCount: result.chunkCount,
              cacheUsed: result.cacheUsed,
              sessionId: result.sessionId,
            }),
          });
        },
        async getTask(_args, { taskId, taskStore: requestTaskStore }) {
          return await requestTaskStore.getTask(taskId);
        },
        async getTaskResult(_args, { taskId, taskStore: requestTaskStore }): Promise<CallToolResult> {
          return (await requestTaskStore.getTaskResult(taskId)) as CallToolResult;
        },
      }
  );

  server.experimental.tasks.registerToolTask<typeof followUpToolInputSchema, typeof followUpToolOutputSchema>(
      "continue_long_video_analysis",
      {
        title: "Continue Long Video Analysis",
        description: [
          "Continue analyzing a previously uploaded long-video session.",
          "When possible, this tool reuses the cached uploaded asset created by analyze_long_youtube_video instead of re-downloading the video.",
          "Use only when analyze_long_youtube_video returned a non-null sessionId.",
        ].join(" "),
        inputSchema: followUpToolInputSchema,
        outputSchema: followUpToolOutputSchema,
        execution: { taskSupport: "required" },
      },
      {
        async createTask(args, extra) {
          const typedArgs = args as FollowUpToolInput;
          const logger = createRequestLogger("continue_long_video_analysis");
          const startedAt = Date.now();

          return runLongTask<FollowUpToolInput, FollowUpToolOutput>({
            toolName: "continue_long_video_analysis",
            taskStore,
            extra: extra as unknown as TaskCreateExtra,
            args: typedArgs,
            logger,
            startedAt,
            execute: (input, context) => service.continueLong(input, context),
            onStartLog: {
              sessionId: typedArgs.sessionId,
              model: typedArgs.model ?? null,
            },
            onSuccessLog: (result) => ({
              sessionId: result.sessionId,
              cacheUsed: result.cacheUsed,
              model: result.model,
            }),
          });
        },
        async getTask(_args, { taskId, taskStore: requestTaskStore }) {
          return await requestTaskStore.getTask(taskId);
        },
        async getTaskResult(_args, { taskId, taskStore: requestTaskStore }): Promise<CallToolResult> {
          return (await requestTaskStore.getTaskResult(taskId)) as CallToolResult;
        },
      }
  );

  return server;
}
