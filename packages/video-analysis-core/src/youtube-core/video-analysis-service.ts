import type { GoogleGenAI } from "@google/genai";

import {
  analyzeYouTubeVideoAudio,
  analyzeLongVideo,
  analyzeShortVideo,
  continueLongVideoAnalysis,
  type AnalysisExecutionContext,
} from "./analysis.js";
import { DiagnosticError } from "../lib/errors.js";
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

    const frame = await extractYouTubeFrame(normalizedYoutubeUrl, input.timestampSeconds, {
      signal: context.abortSignal,
      jpegQuality: input.jpegQuality,
      searchWindowSeconds: input.searchWindowSeconds,
    });

    return {
      youtubeUrl: input.youtubeUrl,
      normalizedYoutubeUrl,
      timestampSeconds: input.timestampSeconds,
      mimeType: "image/jpeg",
      jpegBase64: frame.jpegBase64,
      sizeBytes: frame.sizeBytes,
    };
  }
}
