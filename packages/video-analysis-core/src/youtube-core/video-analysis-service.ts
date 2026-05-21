import type { GoogleGenAI } from "@google/genai";

import { DEFAULT_MODEL, GENERATION_TIMEOUT_MS } from "../lib/constants.js";
import { refineFrameTimestampWithGemini } from "../lib/gemini.js";
import {
  analyzeYouTubeVideoAudio,
  analyzeLongVideo,
  analyzeShortVideo,
  continueLongVideoAnalysis,
  type AnalysisExecutionContext,
} from "./analysis.js";
import { DiagnosticError, asDiagnosticError } from "../lib/errors.js";
import type {
  AudioToolInput,
  AudioToolOutput,
  FollowUpToolInput,
  FollowUpToolOutput,
  LongToolInput,
  LongToolOutput,
  MetadataToolInput,
  MetadataToolOutput,
  FrameToolInput,
  FrameToolOutput,
  ShortToolInput,
  ShortToolOutput,
} from "./schemas.js";
import type { AnalysisSessionStore } from "./session-store.js";
import { fetchYouTubeVideoMetadata } from "./youtube-metadata.js";
import { extractYouTubeFrame, normalizeYouTubeUrl } from "./youtube.js";

export type VideoAnalysisServiceDeps = {
  ai: GoogleGenAI;
  sessionStore: AnalysisSessionStore;
};

export interface VideoAnalysisServiceLike {
  analyzeShort(input: ShortToolInput, context: AnalysisExecutionContext): Promise<ShortToolOutput>;
  analyzeAudio(input: AudioToolInput, context: AnalysisExecutionContext): Promise<AudioToolOutput>;
  analyzeLong(input: LongToolInput, context: AnalysisExecutionContext): Promise<LongToolOutput>;
  continueLong(input: FollowUpToolInput, context: AnalysisExecutionContext): Promise<FollowUpToolOutput>;
  getYouTubeMetadata(input: MetadataToolInput, context: AnalysisExecutionContext): Promise<MetadataToolOutput>;
  getYouTubeFrame(input: FrameToolInput, context: AnalysisExecutionContext): Promise<FrameToolOutput>;
}

export class VideoAnalysisService implements VideoAnalysisServiceLike {
  constructor(private readonly deps: VideoAnalysisServiceDeps) {}

  async analyzeShort(input: ShortToolInput, context: AnalysisExecutionContext): Promise<ShortToolOutput> {
    return analyzeShortVideo(this.deps.ai, input, context);
  }

  async analyzeAudio(input: AudioToolInput, context: AnalysisExecutionContext): Promise<AudioToolOutput> {
    return analyzeYouTubeVideoAudio(this.deps.ai, input, context);
  }

  async analyzeLong(input: LongToolInput, context: AnalysisExecutionContext): Promise<LongToolOutput> {
    return analyzeLongVideo(this.deps.ai, this.deps.sessionStore, input, context);
  }

  async continueLong(input: FollowUpToolInput, context: AnalysisExecutionContext): Promise<FollowUpToolOutput> {
    return continueLongVideoAnalysis(this.deps.ai, this.deps.sessionStore, input, context);
  }

  async getYouTubeMetadata(input: MetadataToolInput, context: AnalysisExecutionContext): Promise<MetadataToolOutput> {
    const normalizedYoutubeUrl = normalizeYouTubeUrl(input.youtubeUrl);
    if (!normalizedYoutubeUrl) {
      throw new DiagnosticError({
        tool: context.tool,
        code: "INVALID_YOUTUBE_URL",
        stage: "metadata",
        message: "youtubeUrl must be a valid YouTube video URL.",
        retryable: false,
      });
    }

    return fetchYouTubeVideoMetadata({
      youtubeUrl: input.youtubeUrl,
      normalizedYoutubeUrl,
      signal: context.abortSignal,
    });
  }

  async getYouTubeFrame(input: FrameToolInput, context: AnalysisExecutionContext): Promise<FrameToolOutput> {
    const normalizedYoutubeUrl = normalizeYouTubeUrl(input.youtubeUrl);
    if (!normalizedYoutubeUrl) {
      throw new DiagnosticError({
        tool: context.tool,
        code: "INVALID_YOUTUBE_URL",
        stage: "download",
        message: "youtubeUrl must be a valid YouTube video URL.",
        retryable: false,
      });
    }

    const requestedTimestampSeconds = input.timestampSeconds;
    let extractionTimestampSeconds = requestedTimestampSeconds;
    let timestampSource: FrameToolOutput["timestampSource"] = "requested";
    let timestampRefinementReason: string | null = null;

    if (input.timestampRefinementPrompt) {
      const refined = await refineFrameTimestampWithGemini(
        this.deps.ai,
        {
          model: input.timestampRefinementModel || DEFAULT_MODEL,
          normalizedYoutubeUrl,
          timestampSeconds: requestedTimestampSeconds,
          windowSeconds: input.timestampRefinementWindowSeconds ?? 60,
          refinementPrompt: input.timestampRefinementPrompt,
        },
        {
          logger: context.logger,
          tool: context.tool,
          stage: "timestamp_refinement",
          code: "GEMINI_TIMESTAMP_REFINEMENT_FAILED",
          failureMessage: "Failed to refine the video frame timestamp with Gemini.",
          inputMode: "youtube_url",
          responseMode: "schema_json",
          timeoutMs: GENERATION_TIMEOUT_MS,
          abortSignal: context.abortSignal,
        }
      );
      extractionTimestampSeconds = refined.timestampSeconds;
      timestampSource = "gemini_refined";
      timestampRefinementReason = refined.reason || null;
      context.logger.info("frame.timestamp_refined", {
        requestedTimestampSeconds,
        extractionTimestampSeconds,
        model: input.timestampRefinementModel || DEFAULT_MODEL,
      });
    }

    try {
      const frame = await extractYouTubeFrame(normalizedYoutubeUrl, extractionTimestampSeconds, {
        signal: context.abortSignal,
        jpegQuality: input.jpegQuality,
        searchWindowSeconds: input.searchWindowSeconds,
      });

      return {
        youtubeUrl: input.youtubeUrl,
        normalizedYoutubeUrl,
        timestampSeconds: extractionTimestampSeconds,
        requestedTimestampSeconds,
        timestampSource,
        timestampRefinementReason,
        source: "local_exact",
        isExactFrame: true,
        mimeType: "image/jpeg",
        imageBase64: frame.jpegBase64,
        jpegBase64: frame.jpegBase64,
        sizeBytes: frame.sizeBytes,
      };
    } catch (error) {
      throw asDiagnosticError(error, {
        tool: context.tool,
        code: "YOUTUBE_FRAME_EXTRACTION_FAILED",
        stage: "download",
        message: "Failed to extract an exact video frame with yt-dlp and ffmpeg.",
      });
    }
  }
}
