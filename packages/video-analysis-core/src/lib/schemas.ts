import { z } from "zod";

import { normalizeYouTubeUrl } from "./youtube.js";

export const defaultAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detectedLanguage: {
      type: "string",
      description: "Dominant language of the video, preferably as a BCP-47 tag such as en, pt-BR, or ja. Use und if uncertain.",
    },
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    keyMoments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          timestamp: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["timestamp", "title", "detail"],
      },
    },
    notableQuotes: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    safetyOrAccuracyNotes: { type: "array", items: { type: "string" } },
  },
  required: [
    "detectedLanguage",
    "summary",
    "topics",
    "keyMoments",
    "notableQuotes",
    "actionItems",
    "safetyOrAccuracyNotes",
  ],
} as const;

export const defaultAudioAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detectedLanguage: {
      type: "string",
      description: "Dominant spoken language in the audio, preferably as a BCP-47 tag such as en, pt-BR, or ja. Use und if uncertain.",
    },
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    transcriptSegments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          timestamp: { type: "string" },
          transcript: {
            type: "string",
            description: "Brief transcript excerpt for an important spoken segment. Keep it short, not a full transcript.",
          },
          translation: {
            type: "string",
            description: "English translation when useful; otherwise return an empty string.",
          },
        },
        required: ["timestamp", "transcript", "translation"],
      },
    },
    notableQuotes: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    safetyOrAccuracyNotes: { type: "array", items: { type: "string" } },
  },
  required: [
    "detectedLanguage",
    "summary",
    "topics",
    "transcriptSegments",
    "notableQuotes",
    "actionItems",
    "safetyOrAccuracyNotes",
  ],
} as const;

export const chunkAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detectedLanguage: {
      type: "string",
      description: "Dominant language of this chunk, preferably as a BCP-47 tag such as en, pt-BR, or ja. Use und if uncertain.",
    },
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    keyMoments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          timestamp: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["timestamp", "title", "detail"],
      },
    },
    notableQuotes: { type: "array", items: { type: "string" } },
    openThreads: { type: "array", items: { type: "string" } },
  },
  required: ["detectedLanguage", "summary", "topics", "keyMoments", "notableQuotes", "openThreads"],
} as const;

export const shortToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL")
    .describe("Public YouTube video URL. Use this tool for short clips or when selecting a bounded time window."),
  analysisPrompt: z.string().trim().min(1).max(6000).optional().describe("Optional focus for the analysis."),
  startOffsetSeconds: z.number().finite().min(0).optional().describe("Start of the clip to analyze, in seconds."),
  endOffsetSeconds: z.number().finite().min(0).optional().describe("End of the clip to analyze, in seconds."),
  model: z.string().trim().min(1).optional().describe("Optional Gemini model override."),
  responseSchemaJson: z.string().trim().min(2).optional().describe("Optional JSON schema object, encoded as a JSON string."),
} satisfies z.ZodRawShape;

export const audioToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL")
    .describe("Public YouTube video URL. Use this for speech/transcript-focused analysis."),
  analysisPrompt: z.string().trim().min(1).max(6000).optional().describe("Optional focus for the audio-only analysis."),
  startOffsetSeconds: z.number().finite().min(0).optional().describe("Start of the audio clip to analyze, in seconds."),
  endOffsetSeconds: z.number().finite().min(0).optional().describe("End of the audio clip to analyze, in seconds."),
  model: z.string().trim().min(1).optional().describe("Optional Gemini model override."),
  responseSchemaJson: z.string().trim().min(2).optional().describe("Optional JSON schema object, encoded as a JSON string."),
} satisfies z.ZodRawShape;

export const longToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL")
    .describe("Public YouTube video URL. Use this only for long videos or VODs."),
  analysisPrompt: z.string().trim().min(1).max(6000).optional().describe("Optional focus for the long-video analysis."),
  chunkModel: z.string().trim().min(1).optional().describe("Optional Gemini model for intermediate chunks."),
  finalModel: z.string().trim().min(1).optional().describe("Optional Gemini model for final synthesis or single-pass analysis."),
  strategy: z
    .enum(["auto", "url_chunks", "uploaded_file"])
    .optional()
    .describe(
      "Use auto by default. Use uploaded_file only when get_youtube_analyzer_capabilities reports yt-dlp, ffmpeg, and temp dir support. Use url_chunks when local download tools are unavailable; it is more compatible but slower."
    ),
  preferCache: z.boolean().optional().describe("Prefer Gemini cached content for uploaded-file single-pass analysis when possible."),
  timeoutSeconds: z
    .number()
    .finite()
    .int()
    .min(30)
    .max(3600)
    .optional()
    .describe(
      "Timeout for internal Gemini generation calls. This does not extend the MCP client's tool-call timeout."
    ),
  maxChunkDurationSeconds: z
    .number()
    .finite()
    .int()
    .min(60)
    .max(3600)
    .optional()
    .describe("Maximum chunk window size for chunked long-video analysis, in seconds."),
  maxRetries: z.number().finite().int().min(0).max(5).optional().describe("Retry count for retryable Gemini chunk calls."),
  responseSchemaJson: z.string().trim().min(2).optional().describe("Optional JSON schema object, encoded as a JSON string."),
} satisfies z.ZodRawShape;

export const followUpToolInputSchema = {
  sessionId: z.string().trim().min(1).describe("Session ID returned by analyze_long_youtube_video when uploaded-file analysis created a reusable session."),
  analysisPrompt: z.string().trim().min(1).max(6000).describe("Follow-up question or analysis request for the existing long-video session."),
  model: z.string().trim().min(1).optional().describe("Optional Gemini model override."),
  responseSchemaJson: z.string().trim().min(2).optional().describe("Optional JSON schema object, encoded as a JSON string."),
} satisfies z.ZodRawShape;

export const longAnalysisJobInputSchema = longToolInputSchema;

export const longAnalysisJobIdInputSchema = {
  jobId: z.string().trim().min(1).describe("Job ID returned by start_long_youtube_analysis."),
} satisfies z.ZodRawShape;

export const capabilitiesToolInputSchema = {} satisfies z.ZodRawShape;

export const metadataToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL"),
} satisfies z.ZodRawShape;

export const frameToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL"),
  timestampSeconds: z.number().finite().min(0).describe("Timestamp of the requested frame, in seconds."),
  jpegQuality: z
    .number()
    .finite()
    .int()
    .min(2)
    .max(31)
    .optional()
    .describe("ffmpeg JPEG quality value. 2 is best quality, 31 is lowest. Defaults to 2."),
  searchWindowSeconds: z
    .number()
    .finite()
    .min(2)
    .max(30)
    .optional()
    .describe("Small download window around the timestamp, in seconds. Defaults to 6."),
  timestampRefinementPrompt: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .optional()
    .describe("Optional visual cue for Gemini to refine the timestamp before local extraction. Gemini returns only a timestamp; it never generates the frame."),
  timestampRefinementWindowSeconds: z
    .number()
    .finite()
    .min(5)
    .max(300)
    .optional()
    .describe("Window around timestampSeconds that Gemini may inspect when refining the timestamp. Defaults to 60."),
  timestampRefinementModel: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional Gemini model override used only for timestamp refinement."),
} satisfies z.ZodRawShape;

const jsonObjectSchema = z.record(z.string(), z.unknown());
const nullableStringSchema = z.string().nullable();

const clipSchema = z.object({
  startOffsetSeconds: z.number().nullable(),
  endOffsetSeconds: z.number().nullable(),
});

const chunkPlanItemSchema = z.object({
  index: z.number(),
  startOffsetSeconds: z.number(),
  endOffsetSeconds: z.number(),
});

const tokenBudgetAttemptSchema = z.object({
  fps: z.number(),
  totalTokens: z.number(),
  thresholdTokens: z.number(),
  fitsBudget: z.boolean(),
});

const tokenBudgetSchema = z.object({
  model: z.string(),
  inputTokenLimit: z.number(),
  thresholdTokens: z.number(),
  selectedAttempt: tokenBudgetAttemptSchema.nullable(),
  attempts: z.array(tokenBudgetAttemptSchema),
});

const modelsUsedSchema = z.object({
  chunkModel: z.string(),
  finalModel: z.string(),
});

const thumbnailSchema = z.object({
  url: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});

const metadataLiveStreamingDetailsSchema = z.object({
  actualStartTime: nullableStringSchema,
  actualEndTime: nullableStringSchema,
  scheduledStartTime: nullableStringSchema,
  scheduledEndTime: nullableStringSchema,
  concurrentViewers: z.number().nullable(),
});

const metadataStatisticsSchema = z.object({
  viewCount: z.number().nullable(),
  likeCount: z.number().nullable(),
  favoriteCount: z.number().nullable(),
  commentCount: z.number().nullable(),
});

const metadataThumbnailsSchema = z.object({
  default: thumbnailSchema.optional(),
  medium: thumbnailSchema.optional(),
  high: thumbnailSchema.optional(),
  standard: thumbnailSchema.optional(),
  maxres: thumbnailSchema.optional(),
});

export const shortToolOutputSchema = {
  model: z.string(),
  youtubeUrl: z.string(),
  normalizedYoutubeUrl: z.string(),
  clip: clipSchema,
  usedCustomSchema: z.boolean(),
  analysis: jsonObjectSchema,
} satisfies z.ZodRawShape;

export const audioToolOutputSchema = {
  model: z.string(),
  youtubeUrl: z.string(),
  normalizedYoutubeUrl: z.string(),
  clip: clipSchema,
  usedCustomSchema: z.boolean(),
  analysis: jsonObjectSchema,
} satisfies z.ZodRawShape;

export const longToolOutputSchema = {
  youtubeUrl: z.string(),
  normalizedYoutubeUrl: z.string(),
  title: nullableStringSchema,
  durationSeconds: z.number(),
  strategyRequested: z.string(),
  strategyUsed: z.string(),
  fallbackReason: nullableStringSchema,
  modelsUsed: modelsUsedSchema,
  chunkPlan: z.array(chunkPlanItemSchema).nullable(),
  chunkCount: z.number(),
  tokenBudget: tokenBudgetSchema.nullable(),
  cacheUsed: z.boolean(),
  sessionId: nullableStringSchema,
  cacheName: nullableStringSchema,
  usedCustomSchema: z.boolean(),
  analysis: jsonObjectSchema,
} satisfies z.ZodRawShape;

export const followUpToolOutputSchema = {
  sessionId: z.string(),
  normalizedYoutubeUrl: z.string(),
  cacheUsed: z.boolean(),
  model: z.string(),
  usedCustomSchema: z.boolean(),
  analysis: jsonObjectSchema,
} satisfies z.ZodRawShape;

const longAnalysisJobStatusSchema = z.enum(["queued", "running", "done", "error", "cancelled"]);

const longAnalysisJobProgressSchema = z.object({
  progress: z.number(),
  total: z.number().optional(),
  message: z.string(),
});

const longAnalysisJobErrorSchema = z.object({
  code: z.string(),
  stage: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  causeMessage: nullableStringSchema,
  details: jsonObjectSchema.nullable(),
});

export const startLongAnalysisJobOutputSchema = {
  jobId: z.string(),
  status: z.literal("queued"),
  statusMessage: nullableStringSchema,
} satisfies z.ZodRawShape;

export const longAnalysisJobStatusOutputSchema = {
  jobId: z.string(),
  status: longAnalysisJobStatusSchema,
  progress: longAnalysisJobProgressSchema.nullable(),
  statusMessage: nullableStringSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
} satisfies z.ZodRawShape;

export const longAnalysisJobResultOutputSchema = {
  jobId: z.string(),
  status: longAnalysisJobStatusSchema,
  result: z.object(longToolOutputSchema).nullable(),
  error: longAnalysisJobErrorSchema.nullable(),
  statusMessage: nullableStringSchema,
} satisfies z.ZodRawShape;

export const cancelLongAnalysisJobOutputSchema = {
  jobId: z.string(),
  status: z.enum(["cancelled", "done", "error"]),
  statusMessage: nullableStringSchema,
} satisfies z.ZodRawShape;

export const capabilitiesToolOutputSchema = {
  transport: z.literal("stdio"),
  mcpToolDeadlineMs: z.number(),
  supportsMcpTasks: z.boolean(),
  ytDlpAvailable: z.boolean(),
  ffmpegAvailable: z.boolean(),
  tempDirWritable: z.boolean(),
  ytDlpCommand: z.string(),
  recommendedLongVideoStrategy: z.enum(["uploaded_file", "url_chunks"]),
  recommendedWorkflow: z.array(z.string()),
  notes: z.array(z.string()),
} satisfies z.ZodRawShape;

export const metadataToolOutputSchema = {
  youtubeUrl: z.string(),
  normalizedYoutubeUrl: z.string(),
  videoId: z.string(),
  title: nullableStringSchema,
  description: nullableStringSchema,
  channelId: nullableStringSchema,
  channelTitle: nullableStringSchema,
  publishedAt: nullableStringSchema,
  durationIso8601: nullableStringSchema,
  durationSeconds: z.number().nullable(),
  definition: nullableStringSchema,
  caption: z.boolean().nullable(),
  licensedContent: z.boolean().nullable(),
  projection: nullableStringSchema,
  dimension: nullableStringSchema,
  privacyStatus: nullableStringSchema,
  embeddable: z.boolean().nullable(),
  liveBroadcastContent: nullableStringSchema,
  liveStreamingDetails: metadataLiveStreamingDetailsSchema.nullable(),
  thumbnails: metadataThumbnailsSchema,
  tags: z.array(z.string()),
  categoryId: nullableStringSchema,
  defaultLanguage: nullableStringSchema,
  defaultAudioLanguage: nullableStringSchema,
  statistics: metadataStatisticsSchema,
} satisfies z.ZodRawShape;

export const frameToolOutputSchema = {
  youtubeUrl: z.string(),
  normalizedYoutubeUrl: z.string(),
  timestampSeconds: z.number(),
  requestedTimestampSeconds: z.number(),
  timestampSource: z.enum(["requested", "gemini_refined"]),
  timestampRefinementReason: nullableStringSchema,
  source: z.literal("local_exact"),
  isExactFrame: z.literal(true),
  mimeType: z.literal("image/jpeg"),
  imageBase64: z.string(),
  jpegBase64: z.string(),
  sizeBytes: z.number(),
} satisfies z.ZodRawShape;

export type ShortToolInput = z.infer<z.ZodObject<typeof shortToolInputSchema>>;
export type AudioToolInput = z.infer<z.ZodObject<typeof audioToolInputSchema>>;
export type LongToolInput = z.infer<z.ZodObject<typeof longToolInputSchema>>;
export type FollowUpToolInput = z.infer<z.ZodObject<typeof followUpToolInputSchema>>;
export type LongAnalysisJobInput = z.infer<z.ZodObject<typeof longAnalysisJobInputSchema>>;
export type LongAnalysisJobIdInput = z.infer<z.ZodObject<typeof longAnalysisJobIdInputSchema>>;
export type CapabilitiesToolInput = z.infer<z.ZodObject<typeof capabilitiesToolInputSchema>>;
export type MetadataToolInput = z.infer<z.ZodObject<typeof metadataToolInputSchema>>;
export type FrameToolInput = z.infer<z.ZodObject<typeof frameToolInputSchema>>;

export type ShortToolOutput = z.infer<z.ZodObject<typeof shortToolOutputSchema>>;
export type AudioToolOutput = z.infer<z.ZodObject<typeof audioToolOutputSchema>>;
export type LongToolOutput = z.infer<z.ZodObject<typeof longToolOutputSchema>>;
export type FollowUpToolOutput = z.infer<z.ZodObject<typeof followUpToolOutputSchema>>;
export type StartLongAnalysisJobOutput = z.infer<z.ZodObject<typeof startLongAnalysisJobOutputSchema>>;
export type LongAnalysisJobStatusOutput = z.infer<z.ZodObject<typeof longAnalysisJobStatusOutputSchema>>;
export type LongAnalysisJobResultOutput = z.infer<z.ZodObject<typeof longAnalysisJobResultOutputSchema>>;
export type CancelLongAnalysisJobOutput = z.infer<z.ZodObject<typeof cancelLongAnalysisJobOutputSchema>>;
export type CapabilitiesToolOutput = z.infer<z.ZodObject<typeof capabilitiesToolOutputSchema>>;
export type MetadataToolOutput = z.infer<z.ZodObject<typeof metadataToolOutputSchema>>;
export type FrameToolOutput = z.infer<z.ZodObject<typeof frameToolOutputSchema>>;

export function parseSchema(
  responseSchemaJson?: string,
  fallbackSchema: Record<string, unknown> = defaultAnalysisSchema as Record<string, unknown>
): Record<string, unknown> {
  if (!responseSchemaJson) {
    return fallbackSchema;
  }

  try {
    const parsed = JSON.parse(responseSchemaJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Schema must be a JSON object.");
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown schema parsing error.";
    throw new Error(`Invalid responseSchemaJson: ${message}`);
  }
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
