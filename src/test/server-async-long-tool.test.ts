import assert from "node:assert/strict";

import type { LongAnalysisJobs } from "@ludylops/video-analysis-core";
import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const capturedInputs: Record<string, unknown>[] = [];
  const longAnalysisJobs: LongAnalysisJobs = {
    async enqueueLongAnalysis(input) {
      capturedInputs.push(input);
      return {
        jobId: "job-1",
        status: "queued",
        pollTool: "get_long_youtube_video_analysis_job",
        estimatedNextPollSeconds: 5,
      };
    },
    async getLongAnalysisJob(jobId) {
      return {
        jobId,
        status: "completed",
        progress: {
          progress: 100,
          total: 100,
          message: "Completed",
        },
        result: {
          youtubeUrl: "https://www.youtube.com/watch?v=test",
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          title: "Long Test",
          durationSeconds: 900,
          strategyRequested: "url_chunks",
          strategyUsed: "url_chunks",
          fallbackReason: null,
          modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
          chunkPlan: null,
          chunkCount: 3,
          tokenBudget: null,
          cacheUsed: false,
          sessionId: null,
          cacheName: null,
          usedCustomSchema: false,
          analysis: { summary: "long async" },
        },
        error: null,
      };
    },
  };

  const server = createServer({
    runtimeMode: "cloud",
    longAnalysisJobs,
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
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    const startResult = await client.callTool({
      name: "start_long_youtube_video_analysis",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        strategy: "url_chunks",
      },
    });

    assert.equal(startResult.isError, undefined);
    assert.deepEqual(startResult.structuredContent, {
      jobId: "job-1",
      status: "queued",
      pollTool: "get_long_youtube_video_analysis_job",
      estimatedNextPollSeconds: 5,
    });
    assert.deepEqual(capturedInputs, [
      {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        analysisPrompt: undefined,
        chunkModel: undefined,
        finalModel: undefined,
        strategy: "url_chunks",
        preferCache: undefined,
        responseSchemaJson: undefined,
      },
    ]);

    const statusResult = await client.callTool({
      name: "get_long_youtube_video_analysis_job",
      arguments: {
        jobId: "job-1",
      },
    });

    assert.equal(statusResult.isError, undefined);
    assert.deepEqual(statusResult.structuredContent, {
      jobId: "job-1",
      status: "completed",
      progress: {
        progress: 100,
        total: 100,
        message: "Completed",
      },
      result: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
        title: "Long Test",
        durationSeconds: 900,
        strategyRequested: "url_chunks",
        strategyUsed: "url_chunks",
        fallbackReason: null,
        modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
        chunkPlan: null,
        chunkCount: 3,
        tokenBudget: null,
        cacheUsed: false,
        sessionId: null,
        cacheName: null,
        usedCustomSchema: false,
        analysis: { summary: "long async" },
      },
      error: null,
    });

    const missingLongToolResult = await client.callTool({
      name: "analyze_long_youtube_video",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
      },
    });

    assert.equal(missingLongToolResult.isError, true);

    const missingFollowUpToolResult = await client.callTool({
      name: "continue_long_video_analysis",
      arguments: {
        sessionId: "session-1",
        analysisPrompt: "Continue",
      },
    });

    assert.equal(missingFollowUpToolResult.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
}
