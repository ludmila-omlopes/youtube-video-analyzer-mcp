import process from "node:process";

export const SERVER_INFO = {
  name: "youtube-analyzer-gemini",
  version: "0.2.0",
} as const;

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
export const DEFAULT_LONG_VIDEO_CHUNK_MODEL = "gemini-2.5-flash";
export const DEFAULT_LONG_VIDEO_FINAL_MODEL = "gemini-2.5-pro";
export const DEFAULT_CHUNK_OVERLAP_SECONDS = 5;
export const MIN_CHUNK_DURATION_SECONDS = 30;
export const DEFAULT_CACHE_TTL_SECONDS = 86_400;
export const DEFAULT_TASK_TTL_MS = Number(process.env.MCP_TASK_TTL_MS || 30 * 60 * 1000);
export const TOKEN_BUDGET_RATIO = 0.7;
export const TOKEN_BUDGET_FPS_CANDIDATES = [1, 0.5, 0.25] as const;
export const YT_DLP_OUTPUT_TEMPLATE = "source.%(ext)s";
export const YT_DLP_DEFAULT_FORMAT = "b[height<=480][ext=mp4]/b[height<=480]/b[ext=mp4]/b";
export const LOW_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_LOW" as const;
export const ALLOW_GEMINI_TEXT_JSON_FALLBACK = process.env.GEMINI_TEXT_JSON_FALLBACK === "true";

export const METADATA_TIMEOUT_MS = Number(process.env.YOUTUBE_METADATA_TIMEOUT_MS || 60_000);
export const DOWNLOAD_TIMEOUT_MS = Number(process.env.YOUTUBE_DOWNLOAD_TIMEOUT_MS || 15 * 60_000);
export const FILE_UPLOAD_TIMEOUT_MS = Number(process.env.GEMINI_FILE_UPLOAD_TIMEOUT_MS || 15 * 60_000);
export const FILE_PROCESSING_DEADLINE_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_DEADLINE_MS || 20 * 60_000
);
export const FILE_PROCESSING_POLL_INTERVAL_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_POLL_INTERVAL_MS || 2_000
);
export const TOKEN_COUNT_TIMEOUT_MS = Number(process.env.GEMINI_TOKEN_COUNT_TIMEOUT_MS || 60_000);
export const CACHE_CREATE_TIMEOUT_MS = Number(process.env.GEMINI_CACHE_CREATE_TIMEOUT_MS || 60_000);
export const GENERATION_TIMEOUT_MS = Number(process.env.GEMINI_GENERATION_TIMEOUT_MS || 10 * 60_000);
export const SYNTHESIS_TIMEOUT_MS = Number(process.env.GEMINI_SYNTHESIS_TIMEOUT_MS || 10 * 60_000);

export const MODEL_INPUT_TOKEN_LIMITS: Record<string, number> = {
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-flash-lite": 1_048_576,
  "gemini-3.1-pro-preview": 1_048_576,
  "gemini-3-flash-preview": 1_048_576,
  "gemini-3.1-flash-lite-preview": 1_048_576,
};

