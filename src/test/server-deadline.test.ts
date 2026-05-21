import assert from "node:assert/strict";

import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export async function run(): Promise<void> {
  let capturedSignal: AbortSignal | undefined;
  const server = createServer({
    deadlines: { toolMs: 20 },
    service: {
      async analyzeShort(_input, context) {
        assert.ok(context.abortSignal);
        capturedSignal = context.abortSignal;
        await waitForAbort(context.abortSignal);
        return {
          model: "gemini-test",
          youtubeUrl: _input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          clip: {
            startOffsetSeconds: null,
            endOffsetSeconds: null,
          },
          usedCustomSchema: false,
          analysis: { summary: "late" },
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
      async getYouTubeFrame() {
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
      },
    });

    assert.equal(result.isError, true);
    assert.ok(capturedSignal);
    assert.equal(capturedSignal.aborted, true);

    assert.equal(result.structuredContent, undefined);
    const content = result.content as Array<{ type: "text"; text: string }>;
    const structuredError = JSON.parse(content[0].text) as {
      error: {
        tool: string;
        code: string;
        message: string;
      };
    };
    assert.equal(structuredError.error.tool, "analyze_youtube_video");
    assert.equal(structuredError.error.code, "MCP_TOOL_DEADLINE_EXCEEDED");
    assert.match(structuredError.error.message, /deadline exceeded/i);
  } finally {
    await client.close();
    await server.close();
  }
}
