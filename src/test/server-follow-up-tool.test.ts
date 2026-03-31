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
      async analyzeLong() {
        throw new Error("Not used");
      },
      async continueLong(input, context) {
        assert.equal(context.tool, "continue_long_video_analysis");
        return {
          sessionId: input.sessionId,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          cacheUsed: true,
          model: input.model || "gemini-2.5-pro",
          usedCustomSchema: false,
          analysis: { summary: "follow-up" },
        };
      },
      async getYouTubeMetadata() {
        throw new Error("Not used");
      },
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    const result = await client.callTool({
      name: "continue_long_video_analysis",
      arguments: {
        sessionId: "session-1",
        analysisPrompt: "Continue the analysis",
      },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      sessionId: "session-1",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      cacheUsed: true,
      model: "gemini-2.5-pro",
      usedCustomSchema: false,
      analysis: { summary: "follow-up" },
    });
  } finally {
    await client.close();
    await server.close();
    taskStore.cleanup();
  }
}
