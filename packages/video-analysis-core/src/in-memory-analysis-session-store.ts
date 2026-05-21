import type { AnalysisSession } from "./youtube-core/types.js";
import type { AnalysisSessionStore } from "./youtube-core/session-store.js";

export type { AnalysisSessionStore } from "./youtube-core/session-store.js";

export class InMemoryAnalysisSessionStore implements AnalysisSessionStore {
  private readonly sessions = new Map<string, AnalysisSession>();

  async get(sessionId: string): Promise<AnalysisSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async set(session: AnalysisSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
