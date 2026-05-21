import assert from "node:assert/strict";

import { ManagedTaskStore } from "../task-store.js";
import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

async function collectTaskToolResult(client: Awaited<ReturnType<typeof createConnectedInMemoryClient>>) {
  let result: unknown;
  const progressUpdates: Array<{ progress: number; total?: number; message?: string }> = [];

  for await (const message of client.experimental.tasks.callToolStream({
    name: "analyze_long_youtube_video",
    arguments: {
      youtubeUrl: "https://www.youtube.com/watch?v=test",
    },
  }, undefined, {
    onprogress: (progress) => {
      progressUpdates.push(progress);
    },
  })) {
    if (message.type === "error") {
      throw message.error;
    }

    if (message.type === "result") {
      result = message.result;
    }
  }

  return {
    result: result as { isError?: boolean; structuredContent?: unknown },
    progressUpdates,
  };
}

export async function run(): Promise<void> {
  const taskStore = new ManagedTaskStore();
  const server = createServer({
    taskStore,
    service: {
      async analyzeShort() {
        throw new Error("Not used");
      },
      async analyzeAudio() {
        throw new Error("Not used");
      },
      async analyzeLong(input, context) {
        assert.equal(context.tool, "analyze_long_youtube_video");
        await context.reportProgress?.({ progress: 1, total: 3, message: "First progress." });
        await context.reportProgress?.({ progress: 1, total: 3, message: "Duplicate progress." });
        await context.reportProgress?.({ progress: 0.5, total: 3, message: "Regressed progress." });
        await context.reportProgress?.({ progress: 2, total: 3, message: "Second progress." });

        return {
          youtubeUrl: input.youtubeUrl,
          normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
          title: "Long Test",
          durationSeconds: 900,
          strategyRequested: input.strategy || "auto",
          strategyUsed: "uploaded_file_single_pass",
          fallbackReason: null,
          modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
          chunkPlan: null,
          chunkCount: 0,
          tokenBudget: null,
          cacheUsed: true,
          sessionId: "session-1",
          cacheName: "cache/test",
          usedCustomSchema: false,
          analysis: { summary: "long" },
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
    await client.listTools();

    await assert.rejects(
      () =>
        client.callTool({
          name: "analyze_long_youtube_video",
          arguments: {
            youtubeUrl: "https://www.youtube.com/watch?v=test",
          },
        }),
      /requires task-based execution/
    );

    const { result, progressUpdates } = await collectTaskToolResult(client);

    assert.equal(result.isError, undefined);
    assert.deepEqual(
      progressUpdates.map((update) => update.progress),
      [1, 2]
    );
    assert.deepEqual(result.structuredContent, {
      youtubeUrl: "https://www.youtube.com/watch?v=test",
      normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test",
      title: "Long Test",
      durationSeconds: 900,
      strategyRequested: "auto",
      strategyUsed: "uploaded_file_single_pass",
      fallbackReason: null,
      modelsUsed: { chunkModel: "gemini-2.5-flash", finalModel: "gemini-2.5-pro" },
      chunkPlan: null,
      chunkCount: 0,
      tokenBudget: null,
      cacheUsed: true,
      sessionId: "session-1",
      cacheName: "cache/test",
      usedCustomSchema: false,
      analysis: { summary: "long" },
    });
  } finally {
    await client.close();
    await server.close();
    taskStore.cleanup();
  }
}
