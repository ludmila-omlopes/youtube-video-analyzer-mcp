import type { BatchPlanItem, ChunkPlanItem } from "../lib/types.js";

type ChunkPlannerParams = {
  durationSeconds: number;
  overlapSeconds: number;
  minChunkDurationSeconds: number;
  canFitChunk: (startOffsetSeconds: number, endOffsetSeconds: number) => Promise<boolean>;
};

type BatchPlannerParams = {
  totalItems: number;
  canFitBatch: (startIndex: number, endIndex: number) => Promise<boolean>;
};

export async function createAdaptiveChunkPlan(params: ChunkPlannerParams): Promise<ChunkPlanItem[]> {
  const durationSeconds = Math.max(1, Math.ceil(params.durationSeconds));
  const minChunkDurationSeconds = Math.max(1, Math.floor(params.minChunkDurationSeconds));
  const overlapSeconds = Math.max(0, Math.floor(params.overlapSeconds));
  const chunks: ChunkPlanItem[] = [];

  let index = 0;
  let startOffsetSeconds = 0;

  while (startOffsetSeconds < durationSeconds) {
    const remainingSeconds = durationSeconds - startOffsetSeconds;
    if (remainingSeconds <= minChunkDurationSeconds) {
      chunks.push({
        index,
        startOffsetSeconds,
        endOffsetSeconds: durationSeconds,
      });
      break;
    }

    const minimumEnd = Math.min(durationSeconds, startOffsetSeconds + minChunkDurationSeconds);
    let left = minimumEnd;
    let right = durationSeconds;
    let bestEndOffsetSeconds: number | null = null;

    while (left <= right) {
      const candidateEndOffsetSeconds = Math.floor((left + right) / 2);
      const fits = await params.canFitChunk(startOffsetSeconds, candidateEndOffsetSeconds);
      if (fits) {
        bestEndOffsetSeconds = candidateEndOffsetSeconds;
        left = candidateEndOffsetSeconds + 1;
      } else {
        right = candidateEndOffsetSeconds - 1;
      }
    }

    if (bestEndOffsetSeconds === null) {
      throw new Error(
        `Unable to find a viable chunk starting at ${startOffsetSeconds}s with a minimum duration of ${minChunkDurationSeconds}s.`
      );
    }

    chunks.push({
      index,
      startOffsetSeconds,
      endOffsetSeconds: bestEndOffsetSeconds,
    });

    if (bestEndOffsetSeconds >= durationSeconds) {
      break;
    }

    startOffsetSeconds = Math.max(bestEndOffsetSeconds - overlapSeconds, startOffsetSeconds + 1);
    index += 1;
  }

  return chunks;
}

export async function createAdaptiveBatchPlan(params: BatchPlannerParams): Promise<BatchPlanItem[]> {
  const batches: BatchPlanItem[] = [];
  let index = 0;
  let startIndex = 0;

  while (startIndex < params.totalItems) {
    let left = startIndex + 1;
    let right = params.totalItems;
    let bestEnd = startIndex + 1;

    while (left <= right) {
      const candidateEnd = Math.floor((left + right) / 2);
      const fits = await params.canFitBatch(startIndex, candidateEnd);
      if (fits) {
        bestEnd = candidateEnd;
        left = candidateEnd + 1;
      } else {
        right = candidateEnd - 1;
      }
    }

    if (bestEnd <= startIndex) {
      throw new Error(`Unable to fit a synthesis batch starting at index ${startIndex}.`);
    }

    batches.push({
      index,
      startIndex,
      endIndex: bestEnd,
    });

    startIndex = bestEnd;
    index += 1;
  }

  return batches;
}
