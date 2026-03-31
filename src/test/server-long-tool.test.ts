import assert from "node:assert/strict";

import { ManagedTaskStore } from "../lib/task-store.js";
import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const taskStore = new ManagedTaskStore();
  const server = createServer({
    taskStore,
    service: {
      async analyzeShort() {
        throw new Error("Not used");
      },
      async analyzeAudio() {
        throw new Error("Not used");
      },
      async analyzeLong(input, context) {
        assert.equal(context.tool, "analyze_long_youtube_video");
        return {
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          title: "Long Test",
          durationSeconds: 900,
          strategyRequested: input.strategy || "auto",
          strategyUsed: "uploaded_file_single_pass",
          fallbackReason: null,
          modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
          chunkPlan: null,
          chunkCount: 0,
          tokenBudget: null,
          cacheUsed: true,
          sessionId: "session-1",
          cacheName: "cache/test",
          usedCustomSchema: false,
          analysis: { summary: "long" },
        };
      },
      async continueLong() {
        throw new Error("Not used");
      },
      async getYouTubeMetadata() {
        throw new Error("Not used");
      },
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    const result = await client.callTool({
      name: "analyze_long_youtube_video",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
      },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      title: "Long Test",
      durationSeconds: 900,
      strategyRequested: "auto",
      strategyUsed: "uploaded_file_single_pass",
      fallbackReason: null,
      modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
      chunkPlan: null,
      chunkCount: 0,
      tokenBudget: null,
      cacheUsed: true,
      sessionId: "session-1",
      cacheName: "cache/test",
      usedCustomSchema: false,
      analysis: { summary: "long" },
    });
  } finally {
    await client.close();
    await server.close();
    taskStore.cleanup();
  }
}
