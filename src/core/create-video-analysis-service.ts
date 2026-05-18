import {
  createDefaultAiClient,
  VideoAnalysisService,
  type VideoAnalysisServiceDeps,
} from "./youtube-core/index.js";
import { InMemoryAnalysisSessionStore } from "./in-memory-analysis-session-store.js";
import type { AnalysisSessionStore } from "./youtube-core/session-store.js";

export type CreateVideoAnalysisServiceOptions = {
  ai?: VideoAnalysisServiceDeps["ai"];
  sessionStore?: AnalysisSessionStore;
};

export function createVideoAnalysisService(
  options: CreateVideoAnalysisServiceOptions = {}
): VideoAnalysisService {
  return new VideoAnalysisService({
    ai: options.ai ?? createDefaultAiClient(),
    sessionStore: options.sessionStore ?? new InMemoryAnalysisSessionStore(),
  });
}
