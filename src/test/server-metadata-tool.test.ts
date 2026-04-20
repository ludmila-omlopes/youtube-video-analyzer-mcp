import assert from "node:assert/strict";

import { DiagnosticError } from "@ludylops/video-analysis-core";
import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const captured: Record<string, unknown>[] = [];
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
      async getYouTubeMetadata(input, context) {
        captured.push({ input, tool: context.tool });
        return {
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          videoId: "test",
          title: "Server Test",
          description: null,
          channelId: "channel-1",
          channelTitle: "Channel",
          publishedAt: "2026-03-24T00:00:00Z",
          durationIso8601: "PT15M1S",
          durationSeconds: 901,
          definition: "hd",
          caption: true,
          licensedContent: false,
          projection: "rectangular",
          dimension: "2d",
          privacyStatus: "public",
          embeddable: true,
          liveBroadcastContent: "none",
          liveStreamingDetails: null,
          thumbnails: {},
          tags: [],
          categoryId: "22",
          defaultLanguage: "en",
          defaultAudioLanguage: "en",
          statistics: {
            viewCount: 100,
            likeCount: 20,
            favoriteCount: 0,
            commentCount: 5,
          },
        };
      },
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    const result = await client.callTool({
      name: "get_youtube_video_metadata",
      arguments: { youtubeUrl: "https://www.youtube.com/watch?v=test" },
    });

    assert.equal(result.isError, undefined);
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0], {
      input: { youtubeUrl: "https://www.youtube.com/watch?v=test" },
      tool: "get_youtube_video_metadata",
    });
    assert.equal((result.structuredContent as { videoId: string }).videoId, "test");
  } finally {
    await client.close();
    await server.close();
  }

  const failingServer = createServer({
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
        throw new DiagnosticError({
          tool: "get_youtube_video_metadata",
          code: "YOUTUBE_API_KEY_MISSING",
          stage: "config",
          message: "Missing YOUTUBE_API_KEY environment variable.",
          retryable: false,
        });
      },
    },
  });

  const failingClient = await createConnectedInMemoryClient(failingServer);
  try {
    const errorResult = await failingClient.callTool({
      name: "get_youtube_video_metadata",
      arguments: { youtubeUrl: "https://www.youtube.com/watch?v=test" },
    });

    assert.equal(errorResult.isError, true);
    const structuredError = errorResult.structuredContent as {
      error: {
        tool: string;
        code: string;
        stage: string;
        message: string;
        retryable: boolean;
        requestId: string;
      };
    };
    assert.equal(structuredError.error.tool, "get_youtube_video_metadata");
    assert.equal(structuredError.error.code, "YOUTUBE_API_KEY_MISSING");
    assert.equal(structuredError.error.stage, "config");
    assert.equal(structuredError.error.message, "Missing YOUTUBE_API_KEY environment variable.");
    assert.equal(structuredError.error.retryable, false);
    assert.equal(typeof structuredError.error.requestId, "string");
  } finally {
    await failingClient.close();
    await failingServer.close();
  }
}
