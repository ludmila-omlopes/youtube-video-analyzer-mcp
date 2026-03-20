import assert from "node:assert/strict";

import { selectDownloadedVideoFile } from "../lib/youtube.js";

export async function run(): Promise<void> {
  assert.equal(
    selectDownloadedVideoFile(["source.f248.webm", "source.f140.m4a", "source.mp4"]),
    "source.mp4"
  );

  assert.equal(
    selectDownloadedVideoFile(["source.part", "source.f251.webm", "source.temp.mp4"]),
    null
  );

  assert.equal(selectDownloadedVideoFile(["source.webm"]), "source.webm");
}
