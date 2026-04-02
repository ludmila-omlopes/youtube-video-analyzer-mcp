import assert from "node:assert/strict";

import {
  RedisAnalysisSessionStore,
  resolveCloudSessionStoreDriver,
} from "../app/cloud-session-store.js";
import type { AnalysisSession } from "../lib/types.js";

class FakeKeyValueClient {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const session: AnalysisSession = {
  sessionId: "session-redis-1",
  ownerId: "https://issuer.example.com/:user-1",
  normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
  uploadedFile: {
    fileName: "files/test",
    fileUri: "https://example.com/test.mp4",
    mimeType: "video/mp4",
  },
  cacheName: "cache/test",
  cacheModel: "gemini-2.5-pro",
  createdAt: "2026-04-02T00:00:00.000Z",
  durationSeconds: 120,
  title: "Test",
};

export async function run(): Promise<void> {
  assert.equal(resolveCloudSessionStoreDriver({}), "memory");
  assert.equal(resolveCloudSessionStoreDriver({ REDIS_URL: "redis://example.test:6379" }), "redis");
  assert.equal(resolveCloudSessionStoreDriver({ SESSION_STORE_DRIVER: "memory" }), "memory");
  assert.equal(resolveCloudSessionStoreDriver({ SESSION_STORE_DRIVER: "redis" }), "redis");

  assert.throws(
    () => resolveCloudSessionStoreDriver({ SESSION_STORE_DRIVER: "sqlite" }),
    /Unsupported SESSION_STORE_DRIVER/
  );

  const store = new RedisAnalysisSessionStore(new FakeKeyValueClient() as never);

  assert.equal(await store.get(session.sessionId), null);

  await store.set(session);
  assert.deepEqual(await store.get(session.sessionId), session);

  await store.delete(session.sessionId);
  assert.equal(await store.get(session.sessionId), null);
}
