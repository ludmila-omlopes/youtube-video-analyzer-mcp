import assert from "node:assert/strict";

import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const captured: Record<string, unknown>[] = [];
  const jpegBase64 = Buffer.from("fake-jpeg").toString("base64");
  const server = createServer({
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
      async continueLong() {
        throw new Error("Not used");
      },
      async getYouTubeMetadata() {
        throw new Error("Not used");
      },
      async getYouTubeFrame(input, context) {
        captured.push({ input, tool: context.tool });
        return {
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          timestampSeconds: input.timestampSeconds,
          mimeType: "image/jpeg",
          jpegBase64,
          sizeBytes: 9,
        };
      },
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "get_youtube_video_frame"));

    const result = await client.callTool({
      name: "get_youtube_video_frame",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        timestampSeconds: 12.5,
        jpegQuality: 2,
      },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      timestampSeconds: 12.5,
      mimeType: "image/jpeg",
      jpegBase64,
      sizeBytes: 9,
    });
    assert.deepEqual(captured[0], {
      input: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        timestampSeconds: 12.5,
        jpegQuality: 2,
        searchWindowSeconds: undefined,
      },
      tool: "get_youtube_video_frame",
    });

    const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    assert.ok(content.some((item) => item.type === "image" && item.data === jpegBase64 && item.mimeType === "image/jpeg"));
  } finally {
    await client.close();
    await server.close();
  }
}
