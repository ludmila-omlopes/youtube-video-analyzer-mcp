import assert from "node:assert/strict";

import {
  getAudioAnalysisChargeCredits,
  getFollowUpChargeCredits,
  getLongAnalysisChargeCredits,
  getShortAnalysisChargeCredits,
} from "../app/pricing.js";

export async function run(): Promise<void> {
  assert.equal(getShortAnalysisChargeCredits(), 1);
  assert.equal(getAudioAnalysisChargeCredits(), 1);
  assert.equal(getFollowUpChargeCredits(), 2);
  assert.equal(
    getLongAnalysisChargeCredits({
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      strategy: "url_chunks",
    }),
    4
  );
  assert.equal(
    getLongAnalysisChargeCredits(
      {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        strategy: "uploaded_file",
      },
      {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
        title: "Test",
        strategyRequested: "uploaded_file",
        strategyUsed: "uploaded_file_chunks",
        fallbackReason: null,
        durationSeconds: 900,
        chunkCount: 3,
        chunkPlan: null,
        tokenBudget: null,
        cacheUsed: false,
        sessionId: null,
        cacheName: null,
        modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
        usedCustomSchema: false,
        analysis: { summary: "ok" },
      }
    ),
    7
  );
}
