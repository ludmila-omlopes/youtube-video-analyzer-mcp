import assert from "node:assert/strict";

import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const captured: Record<string, unknown>[] = [];
  const server = createServer({
    service: {
      async analyzeShort() {
        throw new Error("Not used");
      },
      async analyzeAudio(input, context) {
        captured.push({ input, tool: context.tool });
        return {
          model: input.model || "gemini-3-flash-preview",
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          clip: {
            startOffsetSeconds: input.startOffsetSeconds ?? null,
            endOffsetSeconds: input.endOffsetSeconds ?? null,
          },
          usedCustomSchema: false,
          analysis: {
            detectedLanguage: "en",
            summary: "audio only",
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
      async getYouTubeMetadata() {
        throw new Error("Not used");
      },
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    const result = await client.callTool({
      name: "analyze_youtube_video_audio",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        analysisPrompt: "Focus on spoken claims",
      },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      model: "gemini-3-flash-preview",
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      clip: {
        startOffsetSeconds: null,
        endOffsetSeconds: null,
      },
      usedCustomSchema: false,
      analysis: {
        detectedLanguage: "en",
        summary: "audio only",
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
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0], {
      input: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        analysisPrompt: "Focus on spoken claims",
        startOffsetSeconds: undefined,
        endOffsetSeconds: undefined,
        model: undefined,
        responseSchemaJson: undefined,
      },
      tool: "analyze_youtube_video_audio",
    });
  } finally {
    await client.close();
    await server.close();
  }
}
