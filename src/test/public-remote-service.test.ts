import assert from "node:assert/strict";

import { createPublicRemoteVideoAnalysisService } from "../app/create-public-remote-service.js";
import type { AnalysisSessionStore } from "../app/session-store.js";
import type { AnalysisSession } from "../lib/types.js";
import { testLogger } from "./test-helpers.js";

class FakeCloudSessionStore implements AnalysisSessionStore {
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

export async function run(): Promise<void> {
  const service = createPublicRemoteVideoAnalysisService({
    ai: { models: {} } as never,
    sessionStore: new FakeCloudSessionStore(),
  });
  assert.equal(typeof service.analyzeShort, "function");
  assert.equal(typeof service.analyzeAudio, "function");
  assert.equal(typeof service.analyzeLong, "function");
  assert.equal(typeof service.continueLong, "function");
  assert.equal(typeof service.getYouTubeMetadata, "function");

  const cloudSessionStore = new FakeCloudSessionStore();
  const cloudService = createPublicRemoteVideoAnalysisService({
    ai: {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            detectedLanguage: "en",
            summary: "public follow-up",
            topics: [],
            keyMoments: [],
            notableQuotes: [],
            actionItems: [],
            safetyOrAccuracyNotes: [],
          }),
        }),
      },
    } as never,
    sessionStore: cloudSessionStore,
  });

  await cloudSessionStore.set({
    sessionId: "session-1",
    normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
    uploadedFile: {
      fileName: "files/test",
      fileUri: "https://example.com/test.mp4",
      mimeType: "video/mp4",
    },
    cacheName: "cache/test",
    cacheModel: "gemini-2.5-pro",
    createdAt: "2026-03-25T00:00:00.000Z",
    durationSeconds: 120,
    title: "Test",
  });

  const followUp = await cloudService.continueLong(
    { sessionId: "session-1", analysisPrompt: "Continue" },
    { logger: testLogger, tool: "continue_long_video_analysis" }
  );

  assert.equal(followUp.sessionId, "session-1");
  assert.equal(followUp.analysis.summary, "public follow-up");

  await assert.rejects(
    () =>
      cloudService.continueLong(
        { sessionId: "missing-session", analysisPrompt: "Continue" },
        { logger: testLogger, tool: "continue_long_video_analysis" }
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Unknown analysis session/);
      return true;
    }
  );
}
