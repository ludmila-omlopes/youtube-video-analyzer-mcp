import { InMemoryTaskMessageQueue } from "@modelcontextprotocol/sdk/experimental";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, GetTaskResult, Task } from "@modelcontextprotocol/sdk/types.js";

import { createVideoAnalysisService } from "./app/create-service.js";
import type { VideoAnalysisServiceLike } from "./app/video-analysis-service.js";
import type { AnalysisExecutionContext } from "./lib/analysis.js";
import { DEFAULT_TASK_TTL_MS, SERVER_INFO } from "./lib/constants.js";
import { asDiagnosticError } from "./lib/errors.js";
import { createRequestLogger, type Logger } from "./lib/logger.js";
import {
  audioToolInputSchema,
  audioToolOutputSchema,
  followUpToolInputSchema,
  followUpToolOutputSchema,
  formatJson,
  longToolInputSchema,
  longToolOutputSchema,
  metadataToolInputSchema,
  metadataToolOutputSchema,
  shortToolInputSchema,
  shortToolOutputSchema,
  type FollowUpToolInput,
  type FollowUpToolOutput,
  type LongToolInput,
  type LongToolOutput,
} from "./lib/schemas.js";
import { ManagedTaskStore } from "./lib/task-store.js";
import type { ProgressReporter } from "./lib/types.js";

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
};

function createSuccessToolResult(structuredContent: StructuredSuccess) {
  return {
    content: [{ type: "text" as const, text: formatJson(structuredContent) }],
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
    structuredContent,
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

function createProgressReporter(extra: RequestExtra, logger: Logger): ProgressReporter {
  return async ({ progress, total, message }) => {
    if (extra._meta?.progressToken === undefined) {
      return;
    }

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
  const service = options.service ?? createVideoAnalysisService();
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      logging: {},
      tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
    },
    taskStore,
    taskMessageQueue: new InMemoryTaskMessageQueue(),
  });

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
        const result = await service.getYouTubeMetadata(
          { youtubeUrl },
          createExecutionContext("get_youtube_video_metadata", logger, extra.signal)
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
    "analyze_youtube_video",
    {
      title: "Analyze YouTube Video",
      description: [
        "Analyze a public YouTube video with Google Gemini.",
        "The YouTube URL is normalized to a canonical watch URL, then sent as video input with optional clip offsets attached through videoMetadata.",
        "Detects the dominant language of the video, returns natural-language fields in that language, and accepts an optional custom JSON schema.",
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
        const result = await service.analyzeShort(
          { youtubeUrl, analysisPrompt, startOffsetSeconds, endOffsetSeconds, model, responseSchemaJson },
          createExecutionContext("analyze_youtube_video", logger, extra.signal)
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
        const result = await service.analyzeAudio(
          { youtubeUrl, analysisPrompt, startOffsetSeconds, endOffsetSeconds, model, responseSchemaJson },
          createExecutionContext("analyze_youtube_video_audio", logger, extra.signal)
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

  server.experimental.tasks.registerToolTask<typeof longToolInputSchema, typeof longToolOutputSchema>(
    "analyze_long_youtube_video",
    {
      title: "Analyze Long YouTube Video",
      description: [
        "Analyze a long public YouTube video with Gemini long-video handling.",
        "Auto mode prefers uploaded-file analysis first because Files API is the recommended path for long videos, and falls back to URL chunks when needed.",
        "Direct YouTube URL chunking remains available as an explicit strategy for public videos, but should be treated as a preview-oriented convenience path.",
      ].join(" "),
      inputSchema: longToolInputSchema,
      outputSchema: longToolOutputSchema,
      execution: { taskSupport: "optional" },
    },
    {
      async createTask(args: LongToolInput, extra) {
        const logger = createRequestLogger("analyze_long_youtube_video");
        const startedAt = Date.now();

        return runLongTask<LongToolInput, LongToolOutput>({
          toolName: "analyze_long_youtube_video",
          taskStore,
          extra: extra as unknown as TaskCreateExtra,
          args,
          logger,
          startedAt,
          execute: (input, context) => service.analyzeLong(input, context),
          onStartLog: {
            youtubeUrl: args.youtubeUrl,
            strategyRequested: args.strategy ?? "auto",
            chunkModel: args.chunkModel ?? null,
            finalModel: args.finalModel ?? null,
            preferCache: args.preferCache ?? null,
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
      ].join(" "),
      inputSchema: followUpToolInputSchema,
      outputSchema: followUpToolOutputSchema,
      execution: { taskSupport: "optional" },
    },
    {
      async createTask(args: FollowUpToolInput, extra) {
        const logger = createRequestLogger("continue_long_video_analysis");
        const startedAt = Date.now();

        return runLongTask<FollowUpToolInput, FollowUpToolOutput>({
          toolName: "continue_long_video_analysis",
          taskStore,
          extra: extra as unknown as TaskCreateExtra,
          args,
          logger,
          startedAt,
          execute: (input, context) => service.continueLong(input, context),
          onStartLog: {
            sessionId: args.sessionId,
            model: args.model ?? null,
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




