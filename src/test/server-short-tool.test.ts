import assert from "node:assert/strict";

import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const captured: Record<string, unknown>[] = [];
  const server = createServer({
    service: {
      async analyzeShort(input, context) {
        captured.push({ input, tool: context.tool });
        return {
          model: input.model || "gemini-test",
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          clip: {
            startOffsetSeconds: input.startOffsetSeconds ?? null,
            endOffsetSeconds: input.endOffsetSeconds ?? null,
          },
          usedCustomSchema: false,
          analysis: { summary: "short" },
        };
      },
      async analyzeAudio() {
        throw new Error("Not used");
      },
      async analyzeLong() {
        throw new Error("Not used");
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
      name: "analyze_youtube_video",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        analysisPrompt: "Focus on the main points",
      },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      model: "gemini-test",
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      clip: {
        startOffsetSeconds: null,
        endOffsetSeconds: null,
      },
      usedCustomSchema: false,
      analysis: { summary: "short" },
    });
    assert.equal(captured.length, 1);
  } finally {
    await client.close();
    await server.close();
  }
}
