import type { GoogleGenAI } from "@google/genai";

import {
  analyzeYouTubeVideoAudio,
  analyzeLongVideo,
  analyzeShortVideo,
  continueLongVideoAnalysis,
  type AnalysisExecutionContext,
} from "../lib/analysis.js";
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
  ShortToolInput,
  ShortToolOutput,
} from "../lib/schemas.js";
import { fetchYouTubeVideoMetadata } from "../lib/youtube-metadata.js";
import { normalizeYouTubeUrl } from "../lib/youtube.js";
import type { AnalysisSessionStore } from "./session-store.js";

export type VideoAnalysisServiceDeps = {
  ai: GoogleGenAI;
  sessionStore: AnalysisSessionStore;
  runtimeMode?: "local" | "cloud";
};

export interface VideoAnalysisServiceLike {
  analyzeShort(input: ShortToolInput, context: AnalysisExecutionContext): Promise<ShortToolOutput>;
  analyzeAudio(input: AudioToolInput, context: AnalysisExecutionContext): Promise<AudioToolOutput>;
  analyzeLong(input: LongToolInput, context: AnalysisExecutionContext): Promise<LongToolOutput>;
  continueLong(input: FollowUpToolInput, context: AnalysisExecutionContext): Promise<FollowUpToolOutput>;
  getYouTubeMetadata(input: MetadataToolInput, context: AnalysisExecutionContext): Promise<MetadataToolOutput>;
}

export function applyLongVideoInputRuntimePolicy(
  input: LongToolInput,
  runtimeMode: "local" | "cloud"
): LongToolInput {
  if (runtimeMode !== "cloud" || input.strategy === "url_chunks") {
    return input;
  }

  return {
    ...input,
    strategy: "url_chunks",
  };
}

export class VideoAnalysisService implements VideoAnalysisServiceLike {
  private readonly runtimeMode: "local" | "cloud";

  constructor(private readonly deps: VideoAnalysisServiceDeps) {
    this.runtimeMode = deps.runtimeMode ?? "local";
  }

  async analyzeShort(input: ShortToolInput, context: AnalysisExecutionContext): Promise<ShortToolOutput> {
    return analyzeShortVideo(this.deps.ai, input, context);
  }

  async analyzeAudio(input: AudioToolInput, context: AnalysisExecutionContext): Promise<AudioToolOutput> {
    return analyzeYouTubeVideoAudio(this.deps.ai, input, context);
  }

  async analyzeLong(input: LongToolInput, context: AnalysisExecutionContext): Promise<LongToolOutput> {
    const effectiveInput = applyLongVideoInputRuntimePolicy(input, this.runtimeMode);

    if (effectiveInput !== input) {
      context.logger.info("long_video.cloud_strategy_forced", {
        requestedStrategy: input.strategy ?? "auto",
        effectiveStrategy: effectiveInput.strategy,
      });
    }

    return analyzeLongVideo(this.deps.ai, this.deps.sessionStore, effectiveInput, context);
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
}
