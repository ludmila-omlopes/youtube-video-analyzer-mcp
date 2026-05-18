import type { AnalysisSession } from "./types.js";

export interface AnalysisSessionStore {
  get(sessionId: string): Promise<AnalysisSession | null>;
  set(session: AnalysisSession): Promise<void>;
  delete?(sessionId: string): Promise<void>;
}
