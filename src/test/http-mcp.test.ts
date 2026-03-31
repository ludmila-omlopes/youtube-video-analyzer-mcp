import assert from "node:assert/strict";

import { createMcpHttpHandler } from "../http/mcp.js";
import { createConnectedHttpClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const handler = createMcpHttpHandler({
    service: {
      async analyzeShort(input) {
        return {
          model: "gemini-test",
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          clip: { startOffsetSeconds: null, endOffsetSeconds: null },
          usedCustomSchema: false,
          analysis: { summary: "http-short" },
        };
      },
      async analyzeAudio(input) {
        return {
          model: input.model || "gemini-3-flash-preview",
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          clip: { startOffsetSeconds: null, endOffsetSeconds: null },
          usedCustomSchema: false,
          analysis: {
            detectedLanguage: "en",
            summary: "http-audio",
            topics: ["topic"],
            transcriptSegments: [
              {
                timestamp: "00:12",
                transcript: "Short excerpt.",
                translation: "",
              },
            ],
            notableQuotes: ["Short excerpt."],
            actionItems: [],
            safetyOrAccuracyNotes: [],
          },
        };
      },
      async analyzeLong() {
        throw new Error("Not used");
      },
      async continueLong() {
        throw new Error("Not used");
      },
      async getYouTubeMetadata(input) {
        return {
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          videoId: "test",
          title: "HTTP Test",
          description: "Metadata",
          channelId: "channel-1",
          channelTitle: "Test Channel",
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
          thumbnails: {
            default: { url: "https://example.com/default.jpg", width: 120, height: 90 },
          },
          tags: ["test"],
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

  const client = await createConnectedHttpClient(handler);

  try {
    const result = await client.callTool({
      name: "analyze_youtube_video",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
      },
    });

    assert.deepEqual(result.structuredContent, {
      model: "gemini-test",
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      clip: { startOffsetSeconds: null, endOffsetSeconds: null },
      usedCustomSchema: false,
      analysis: { summary: "http-short" },
    });

    const audioResult = await client.callTool({
      name: "analyze_youtube_video_audio",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
      },
    });

    assert.deepEqual(audioResult.structuredContent, {
      model: "gemini-3-flash-preview",
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      clip: { startOffsetSeconds: null, endOffsetSeconds: null },
      usedCustomSchema: false,
      analysis: {
        detectedLanguage: "en",
        summary: "http-audio",
        topics: ["topic"],
        transcriptSegments: [
          {
            timestamp: "00:12",
            transcript: "Short excerpt.",
            translation: "",
          },
        ],
        notableQuotes: ["Short excerpt."],
        actionItems: [],
        safetyOrAccuracyNotes: [],
      },
    });

    const metadataResult = await client.callTool({
      name: "get_youtube_video_metadata",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
      },
    });

    assert.deepEqual(metadataResult.structuredContent, {
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      videoId: "test",
      title: "HTTP Test",
      description: "Metadata",
      channelId: "channel-1",
      channelTitle: "Test Channel",
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
      thumbnails: {
        default: { url: "https://example.com/default.jpg", width: 120, height: 90 },
      },
      tags: ["test"],
      categoryId: "22",
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
      statistics: {
        viewCount: 100,
        likeCount: 20,
        favoriteCount: 0,
        commentCount: 5,
      },
    });
  } finally {
    await client.close();
  }
}
