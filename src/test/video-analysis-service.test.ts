import assert from "node:assert/strict";

import { InMemoryAnalysisSessionStore } from "../app/session-store.js";
import { applyLongVideoInputRuntimePolicy, VideoAnalysisService } from "../app/video-analysis-service.js";
import { testLogger } from "./test-helpers.js";

export async function run(): Promise<void> {
  const sessionStore = new InMemoryAnalysisSessionStore();
  await sessionStore.set({
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

  const ai = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          detectedLanguage: "en",
          summary: "follow-up",
          topics: [],
          keyMoments: [],
          notableQuotes: [],
          actionItems: [],
          safetyOrAccuracyNotes: [],
        }),
      }),
    },
  };

  const localService = new VideoAnalysisService({ ai: ai as never, sessionStore });
  const followUp = await localService.continueLong(
    { sessionId: "session-1", analysisPrompt: "Continue" },
    { logger: testLogger, tool: "continue_long_video_analysis" }
  );

  assert.equal(followUp.sessionId, "session-1");
  assert.deepEqual(followUp.analysis, {
    detectedLanguage: "en",
    summary: "follow-up",
    topics: [],
    keyMoments: [],
    notableQuotes: [],
    actionItems: [],
    safetyOrAccuracyNotes: [],
  });

  const audioService = new VideoAnalysisService({
    ai: {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            detectedLanguage: "en",
            summary: "audio summary",
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
          }),
        }),
      },
    } as never,
    sessionStore,
  });

  const audioResult = await audioService.analyzeAudio(
    { youtubeUrl: "https://youtu.be/test", analysisPrompt: "Focus on spoken claims" },
    { logger: testLogger, tool: "analyze_youtube_video_audio" }
  );

  assert.equal(audioResult.model, "gemini-3-flash-preview");
  assert.equal(audioResult.normalizedYoutubeUrl, "https://www.youtube.com/watch?v=test");
  assert.deepEqual(audioResult.analysis, {
    detectedLanguage: "en",
    summary: "audio summary",
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
  });

  const previousYouTubeApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-youtube-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            snippet: {
              title: "Video",
              channelId: "channel-1",
              channelTitle: "Channel",
              publishedAt: "2026-03-24T00:00:00Z",
              liveBroadcastContent: "none",
            },
            contentDetails: {
              duration: "PT2M",
              definition: "hd",
              caption: "true",
              licensedContent: false,
              projection: "rectangular",
              dimension: "2d",
            },
            status: {
              privacyStatus: "public",
              embeddable: true,
            },
            statistics: {
              viewCount: "1",
              likeCount: "2",
              favoriteCount: "0",
              commentCount: "3",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const metadata = await localService.getYouTubeMetadata(
      { youtubeUrl: "https://youtu.be/test" },
      { logger: testLogger, tool: "get_youtube_video_metadata" }
    );

    assert.equal(metadata.videoId, "test");
    assert.equal(metadata.normalizedYoutubeUrl, "https://www.youtube.com/watch?v=test");
  } finally {
    if (previousYouTubeApiKey === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = previousYouTubeApiKey;
    }

    globalThis.fetch = previousFetch;
  }

  const cloudAutoInput = {
    youtubeUrl: "https://www.youtube.com/watch?v=test",
    analysisPrompt: "Analyze",
  };
  assert.deepEqual(applyLongVideoInputRuntimePolicy(cloudAutoInput, "cloud"), {
    ...cloudAutoInput,
    strategy: "url_chunks",
  });

  assert.deepEqual(
    applyLongVideoInputRuntimePolicy({ ...cloudAutoInput, strategy: "uploaded_file" }, "cloud"),
    {
      ...cloudAutoInput,
      strategy: "url_chunks",
    }
  );

  const cloudUrlChunksInput = { ...cloudAutoInput, strategy: "url_chunks" as const };
  assert.equal(applyLongVideoInputRuntimePolicy(cloudUrlChunksInput, "cloud"), cloudUrlChunksInput);

  assert.equal(applyLongVideoInputRuntimePolicy(cloudAutoInput, "local"), cloudAutoInput);
}
