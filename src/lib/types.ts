import type { LOW_MEDIA_RESOLUTION } from "./constants.js";

export type JsonObject = Record<string, unknown>;

export type LongVideoStrategy = "auto" | "url_chunks" | "uploaded_file";

export type ChunkPlanItem = {
  index: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
};

export type BatchPlanItem = {
  index: number;
  startIndex: number;
  endIndex: number;
};

export type UploadedVideoHandle = {
  fileName: string;
  fileUri: string;
  mimeType: string;
};

export type DownloadedVideo = {
  filePath: string;
  mimeType: string;
  tempDir: string;
};

export type YtDlpMetadata = {
  durationSeconds: number;
  title: string | null;
  uploader: string | null;
  uploadDate: string | null;
  liveStatus: string | null;
};

export type AnalysisSession = {
  sessionId: string;
  normalizedYoutubeUrl: string;
  uploadedFile: UploadedVideoHandle;
  cacheName?: string;
  cacheModel?: string;
  cacheExpireTime?: string;
  fps?: number;
  mediaResolution?: typeof LOW_MEDIA_RESOLUTION;
  createdAt: string;
  durationSeconds: number;
  title: string | null;
};

export type TokenBudgetAttempt = {
  fps: number;
  totalTokens: number;
  thresholdTokens: number;
  fitsBudget: boolean;
};

export type TokenBudgetDecision = {
  model: string;
  inputTokenLimit: number;
  thresholdTokens: number;
  selectedAttempt: TokenBudgetAttempt | null;
  attempts: TokenBudgetAttempt[];
};

export type VideoSource =
  | { kind: "youtube_url"; normalizedYoutubeUrl: string }
  | { kind: "uploaded_file"; uploadedFile: UploadedVideoHandle };

export type VideoPartOptions = {
  startOffsetSeconds?: number;
  endOffsetSeconds?: number;
  fps?: number;
  mediaResolution?: typeof LOW_MEDIA_RESOLUTION;
};

export type ProgressUpdate = {
  progress: number;
  total?: number;
  message: string;
};

export type ProgressReporter = (update: ProgressUpdate) => Promise<void>;
