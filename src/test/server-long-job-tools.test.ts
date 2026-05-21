import assert from "node:assert/strict";

import { LongAnalysisJobStore } from "../long-analysis-job-store.js";
import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

function waitForTerminalJob(
  client: Awaited<ReturnType<typeof createConnectedInMemoryClient>>,
  jobId: string
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const result = await client.callTool({
          name: "get_long_youtube_analysis_result",
          arguments: { jobId },
        });
        const output = result.structuredContent as Record<string, unknown>;
        if (["done", "error", "cancelled"].includes(String(output.status))) {
          resolve(output);
          return;
        }

        if (Date.now() - startedAt > 5000) {
          reject(new Error("Timed out waiting for job."));
          return;
        }

        setTimeout(poll, 20);
      } catch (error) {
        reject(error);
      }
    };

    void poll();
  });
}

export async function run(): Promise<void> {
  const longAnalysisJobStore = new LongAnalysisJobStore();
  let releaseAnalysis: (() => void) | undefined;
  let analysisStarted: Promise<void>;
  let resolveAnalysisStarted: (() => void) | undefined;
  analysisStarted = new Promise((resolve) => {
    resolveAnalysisStarted = resolve;
  });

  const server = createServer({
    longAnalysisJobStore,
    service: {
      async analyzeShort() {
        throw new Error("Not used");
      },
      async analyzeAudio() {
        throw new Error("Not used");
      },
      async analyzeLong(input, context) {
        const abortSignal = context.abortSignal;
        assert.ok(abortSignal);
        resolveAnalysisStarted?.();
        await context.reportProgress?.({ progress: 1, total: 2, message: "Started test analysis." });
        await context.reportProgress?.({ progress: 0.5, total: 2, message: "Regressed test analysis." });
        await new Promise<void>((resolve) => {
          if (abortSignal.aborted) {
            resolve();
            return;
          }

          releaseAnalysis = resolve;
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });

        if (abortSignal.aborted) {
          throw new Error("Cancelled by test");
        }

        await context.reportProgress?.({ progress: 2, total: 2, message: "Finished test analysis." });
        return {
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          title: "Long Job Test",
          durationSeconds: 900,
          strategyRequested: input.strategy || "auto",
          strategyUsed: "url_chunks",
          fallbackReason: null,
          modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
          chunkPlan: null,
          chunkCount: 1,
          tokenBudget: null,
          cacheUsed: false,
          sessionId: null,
          cacheName: null,
          usedCustomSchema: false,
          analysis: { summary: "job done" },
        };
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
    const startResult = await client.callTool({
      name: "start_long_youtube_analysis",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        strategy: "url_chunks",
      },
    });

    assert.equal(startResult.isError, undefined);
    const startOutput = startResult.structuredContent as { jobId: string; status: string };
    assert.equal(startOutput.status, "queued");
    assert.ok(startOutput.jobId);

    await analysisStarted;

    const statusResult = await client.callTool({
      name: "get_long_youtube_analysis_status",
      arguments: { jobId: startOutput.jobId },
    });
    assert.equal(statusResult.isError, undefined);
    assert.equal((statusResult.structuredContent as { status: string }).status, "running");
    assert.equal(
      (statusResult.structuredContent as { progress: { progress: number; message: string } }).progress.message,
      "Started test analysis."
    );

    const pendingResult = await client.callTool({
      name: "get_long_youtube_analysis_result",
      arguments: { jobId: startOutput.jobId },
    });
    assert.equal(pendingResult.isError, undefined);
    assert.equal((pendingResult.structuredContent as { result: unknown }).result, null);

    releaseAnalysis?.();
    const finalOutput = await waitForTerminalJob(client, startOutput.jobId);
    assert.equal(finalOutput.status, "done");
    assert.deepEqual((finalOutput.result as { analysis: unknown }).analysis, { summary: "job done" });

    resolveAnalysisStarted = undefined;
    analysisStarted = Promise.resolve();

    const cancelStartResult = await client.callTool({
      name: "start_long_youtube_analysis",
      arguments: {
        youtubeUrl: "https://www.youtube.com/watch?v=test",
        strategy: "url_chunks",
      },
    });
    const cancelJobId = (cancelStartResult.structuredContent as { jobId: string }).jobId;
    const cancelResult = await client.callTool({
      name: "cancel_long_youtube_analysis",
      arguments: { jobId: cancelJobId },
    });
    assert.equal(cancelResult.isError, undefined);
    assert.equal((cancelResult.structuredContent as { status: string }).status, "cancelled");

    const missingResult = await client.callTool({
      name: "get_long_youtube_analysis_status",
      arguments: { jobId: "missing" },
    });
    assert.equal(missingResult.isError, true);
  } finally {
    await client.close();
    await server.close();
    longAnalysisJobStore.cleanup();
  }
}
