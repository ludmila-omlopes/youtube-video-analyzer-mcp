import type { LongToolInput, LongToolOutput } from "../lib/schemas.js";

export function getShortAnalysisChargeCredits(): number {
  return 1;
}

export function getAudioAnalysisChargeCredits(): number {
  return 1;
}

export function getFollowUpChargeCredits(): number {
  return 2;
}

export function getLongAnalysisChargeCredits(input: LongToolInput, result?: LongToolOutput): number {
  const strategy = result?.strategyUsed ?? input.strategy ?? "auto";

  if (strategy === "url_chunks") {
    return 4;
  }

  if (strategy === "uploaded_file_chunks") {
    return result?.chunkCount ? Math.max(6, 4 + result.chunkCount) : 6;
  }

  return 5;
}
