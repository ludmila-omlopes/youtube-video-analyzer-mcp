import assert from "node:assert/strict";

import { createAdaptiveBatchPlan, createAdaptiveChunkPlan } from "../lib/chunk-planner.js";

export async function run(): Promise<void> {
  const singleChunkPlan = await createAdaptiveChunkPlan({
    durationSeconds: 120,
    overlapSeconds: 5,
    minChunkDurationSeconds: 30,
    canFitChunk: async () => true,
  });
  assert.deepEqual(singleChunkPlan, [{ index: 0, startOffsetSeconds: 0, endOffsetSeconds: 120 }]);

  const overlappedPlan = await createAdaptiveChunkPlan({
    durationSeconds: 100,
    overlapSeconds: 5,
    minChunkDurationSeconds: 10,
    canFitChunk: async (startOffsetSeconds, endOffsetSeconds) => endOffsetSeconds - startOffsetSeconds <= 60,
  });
  assert.deepEqual(overlappedPlan, [
    { index: 0, startOffsetSeconds: 0, endOffsetSeconds: 60 },
    { index: 1, startOffsetSeconds: 55, endOffsetSeconds: 100 },
  ]);

  const batches = await createAdaptiveBatchPlan({
    totalItems: 5,
    canFitBatch: async (startIndex, endIndex) => endIndex - startIndex <= 2,
  });
  assert.deepEqual(batches, [
    { index: 0, startIndex: 0, endIndex: 2 },
    { index: 1, startIndex: 2, endIndex: 4 },
    { index: 2, startIndex: 4, endIndex: 5 },
  ]);
}
