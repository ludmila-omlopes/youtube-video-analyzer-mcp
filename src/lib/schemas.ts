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
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL"),
  analysisPrompt: z.string().trim().min(1).max(6000).optional(),
  startOffsetSeconds: z.number().finite().min(0).optional(),
  endOffsetSeconds: z.number().finite().min(0).optional(),
  model: z.string().trim().min(1).optional(),
  responseSchemaJson: z.string().trim().min(2).optional(),
} satisfies z.ZodRawShape;

export const audioToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL"),
  analysisPrompt: z.string().trim().min(1).max(6000).optional(),
  startOffsetSeconds: z.number().finite().min(0).optional(),
  endOffsetSeconds: z.number().finite().min(0).optional(),
  model: z.string().trim().min(1).optional(),
  responseSchemaJson: z.string().trim().min(2).optional(),
} satisfies z.ZodRawShape;

export const longToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL"),
  analysisPrompt: z.string().trim().min(1).max(6000).optional(),
  chunkModel: z.string().trim().min(1).optional(),
  finalModel: z.string().trim().min(1).optional(),
  strategy: z.enum(["auto", "url_chunks", "uploaded_file"]).optional(),
  preferCache: z.boolean().optional(),
  responseSchemaJson: z.string().trim().min(2).optional(),
} satisfies z.ZodRawShape;

export const followUpToolInputSchema = {
  sessionId: z.string().trim().min(1),
  analysisPrompt: z.string().trim().min(1).max(6000),
  model: z.string().trim().min(1).optional(),
  responseSchemaJson: z.string().trim().min(2).optional(),
} satisfies z.ZodRawShape;

export const metadataToolInputSchema = {
  youtubeUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => normalizeYouTubeUrl(value) !== null, "youtubeUrl must be a valid YouTube URL"),
} satisfies z.ZodRawShape;

const jsonObjectSchema = z.record(z.unknown());
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

export type ShortToolInput = z.infer<z.ZodObject<typeof shortToolInputSchema>>;
export type AudioToolInput = z.infer<z.ZodObject<typeof audioToolInputSchema>>;
export type LongToolInput = z.infer<z.ZodObject<typeof longToolInputSchema>>;
export type FollowUpToolInput = z.infer<z.ZodObject<typeof followUpToolInputSchema>>;
export type MetadataToolInput = z.infer<z.ZodObject<typeof metadataToolInputSchema>>;

export type ShortToolOutput = z.infer<z.ZodObject<typeof shortToolOutputSchema>>;
export type AudioToolOutput = z.infer<z.ZodObject<typeof audioToolOutputSchema>>;
export type LongToolOutput = z.infer<z.ZodObject<typeof longToolOutputSchema>>;
export type FollowUpToolOutput = z.infer<z.ZodObject<typeof followUpToolOutputSchema>>;
export type MetadataToolOutput = z.infer<z.ZodObject<typeof metadataToolOutputSchema>>;

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
