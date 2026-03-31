import process from "node:process";

import { METADATA_TIMEOUT_MS } from "./constants.js";
import { DiagnosticError } from "./errors.js";
import type { MetadataToolOutput } from "./schemas.js";
import type { YtDlpMetadata } from "./types.js";

type FetchYouTubeVideoMetadataOptions = {
  youtubeUrl: string;
  normalizedYoutubeUrl: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ThumbnailValue = {
  url: string;
  width: number | null;
  height: number | null;
};

type ThumbnailMap = Partial<Record<"default" | "medium" | "high" | "standard" | "maxres", ThumbnailValue>>;

function combineAbortSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeoutSignal;
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }

  const controller = new AbortController();
  const abort = (reason?: unknown) => controller.abort(reason);
  if (signal.aborted) {
    abort(signal.reason);
  } else {
    signal.addEventListener("abort", () => abort(signal.reason), { once: true });
  }

  if (timeoutSignal.aborted) {
    abort(timeoutSignal.reason);
  } else {
    timeoutSignal.addEventListener("abort", () => abort(timeoutSignal.reason), { once: true });
  }

  return controller.signal;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function coerceString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function coerceBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function coerceThumbnailMap(value: unknown): ThumbnailMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const thumbnails = value as Record<string, unknown>;
  const sizes = ["default", "medium", "high", "standard", "maxres"] as const;
  const normalized: ThumbnailMap = {};

  for (const size of sizes) {
    const candidate = thumbnails[size];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }

    const thumbnail = candidate as Record<string, unknown>;
    const url = coerceString(thumbnail.url);
    if (!url) {
      continue;
    }

    normalized[size] = {
      url,
      width: coerceNumber(thumbnail.width),
      height: coerceNumber(thumbnail.height),
    };
  }

  return normalized;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

export function extractYouTubeVideoId(normalizedYoutubeUrl: string): string {
  const url = new URL(normalizedYoutubeUrl);
  const videoId = url.searchParams.get("v");
  if (!videoId) {
    throw new DiagnosticError({
      tool: "get_youtube_video_metadata",
      code: "INVALID_YOUTUBE_URL",
      stage: "metadata",
      message: "Normalized YouTube URL is missing a video ID.",
      retryable: false,
      details: { normalizedYoutubeUrl },
    });
  }

  return videoId;
}

export function parseIso8601DurationToSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value);
  if (!match) {
    return null;
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

export function getRequiredYouTubeApiKey(): string {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new DiagnosticError({
      tool: "get_youtube_video_metadata",
      code: "YOUTUBE_API_KEY_MISSING",
      stage: "config",
      message: "Missing YOUTUBE_API_KEY environment variable.",
      retryable: false,
    });
  }

  return apiKey;
}

function normalizeMetadataResponse(params: {
  youtubeUrl: string;
  normalizedYoutubeUrl: string;
  videoId: string;
  item: Record<string, unknown>;
}): MetadataToolOutput {
  const snippet =
    params.item.snippet && typeof params.item.snippet === "object" && !Array.isArray(params.item.snippet)
      ? (params.item.snippet as Record<string, unknown>)
      : {};
  const contentDetails =
    params.item.contentDetails &&
    typeof params.item.contentDetails === "object" &&
    !Array.isArray(params.item.contentDetails)
      ? (params.item.contentDetails as Record<string, unknown>)
      : {};
  const statistics =
    params.item.statistics && typeof params.item.statistics === "object" && !Array.isArray(params.item.statistics)
      ? (params.item.statistics as Record<string, unknown>)
      : {};
  const status =
    params.item.status && typeof params.item.status === "object" && !Array.isArray(params.item.status)
      ? (params.item.status as Record<string, unknown>)
      : {};
  const liveStreamingDetails =
    params.item.liveStreamingDetails &&
    typeof params.item.liveStreamingDetails === "object" &&
    !Array.isArray(params.item.liveStreamingDetails)
      ? (params.item.liveStreamingDetails as Record<string, unknown>)
      : null;

  const durationIso8601 = coerceString(contentDetails.duration);

  return {
    youtubeUrl: params.youtubeUrl,
    normalizedYoutubeUrl: params.normalizedYoutubeUrl,
    videoId: params.videoId,
    title: coerceString(snippet.title),
    description: coerceString(snippet.description),
    channelId: coerceString(snippet.channelId),
    channelTitle: coerceString(snippet.channelTitle),
    publishedAt: coerceString(snippet.publishedAt),
    durationIso8601,
    durationSeconds: parseIso8601DurationToSeconds(durationIso8601),
    definition: coerceString(contentDetails.definition),
    caption:
      typeof contentDetails.caption === "string"
        ? contentDetails.caption === "true"
        : coerceBoolean(contentDetails.caption),
    licensedContent: coerceBoolean(contentDetails.licensedContent),
    projection: coerceString(contentDetails.projection),
    dimension: coerceString(contentDetails.dimension),
    privacyStatus: coerceString(status.privacyStatus),
    embeddable: coerceBoolean(status.embeddable),
    liveBroadcastContent: coerceString(snippet.liveBroadcastContent),
    liveStreamingDetails: liveStreamingDetails
      ? {
          actualStartTime: coerceString(liveStreamingDetails.actualStartTime),
          actualEndTime: coerceString(liveStreamingDetails.actualEndTime),
          scheduledStartTime: coerceString(liveStreamingDetails.scheduledStartTime),
          scheduledEndTime: coerceString(liveStreamingDetails.scheduledEndTime),
          concurrentViewers: coerceNumber(liveStreamingDetails.concurrentViewers),
        }
      : null,
    thumbnails: coerceThumbnailMap(snippet.thumbnails),
    tags: coerceStringArray(snippet.tags),
    categoryId: coerceString(snippet.categoryId),
    defaultLanguage: coerceString(snippet.defaultLanguage),
    defaultAudioLanguage: coerceString(snippet.defaultAudioLanguage),
    statistics: {
      viewCount: coerceNumber(statistics.viewCount),
      likeCount: coerceNumber(statistics.likeCount),
      favoriteCount: coerceNumber(statistics.favoriteCount),
      commentCount: coerceNumber(statistics.commentCount),
    },
  };
}

export async function fetchYouTubeVideoMetadata(
  options: FetchYouTubeVideoMetadataOptions
): Promise<MetadataToolOutput> {
  const apiKey = getRequiredYouTubeApiKey();
  const videoId = extractYouTubeVideoId(options.normalizedYoutubeUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails,statistics,status,liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  const signal = combineAbortSignals(options.signal, options.timeoutMs ?? METADATA_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new DiagnosticError({
      tool: "get_youtube_video_metadata",
      code: "YOUTUBE_METADATA_FETCH_FAILED",
      stage: "metadata",
      message: `YouTube Data API request failed with status ${response.status}.`,
      retryable: response.status >= 500 || response.status === 429,
      details: {
        status: response.status,
        responseText: responseText || null,
        videoId,
      },
    });
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.items)) {
    throw new DiagnosticError({
      tool: "get_youtube_video_metadata",
      code: "INVALID_YOUTUBE_API_RESPONSE",
      stage: "metadata",
      message: "YouTube Data API returned an invalid response payload.",
      retryable: false,
      details: { videoId },
    });
  }

  const [item] = payload.items as unknown[];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new DiagnosticError({
      tool: "get_youtube_video_metadata",
      code: "YOUTUBE_VIDEO_NOT_FOUND",
      stage: "metadata",
      message: "Video not found or unavailable through the YouTube Data API.",
      retryable: false,
      details: { videoId },
    });
  }

  return normalizeMetadataResponse({
    youtubeUrl: options.youtubeUrl,
    normalizedYoutubeUrl: options.normalizedYoutubeUrl,
    videoId,
    item: item as Record<string, unknown>,
  });
}

export async function fetchLongVideoMetadata(options: FetchYouTubeVideoMetadataOptions): Promise<YtDlpMetadata> {
  const metadata = await fetchYouTubeVideoMetadata(options);

  if (!metadata.durationSeconds || metadata.durationSeconds <= 0) {
    throw new DiagnosticError({
      tool: "analyze_long_youtube_video",
      code: "YOUTUBE_METADATA_DURATION_MISSING",
      stage: "metadata",
      message: "YouTube Data API metadata did not include a usable video duration.",
      retryable: false,
      details: {
        videoId: metadata.videoId,
        durationIso8601: metadata.durationIso8601,
      },
    });
  }

  return {
    durationSeconds: metadata.durationSeconds,
    title: metadata.title,
    uploader: metadata.channelTitle,
    uploadDate: metadata.publishedAt,
    liveStatus: metadata.liveBroadcastContent,
  };
}
