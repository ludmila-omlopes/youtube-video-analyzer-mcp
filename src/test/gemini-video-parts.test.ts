import assert from "node:assert/strict";

import { LOW_MEDIA_RESOLUTION } from "../lib/constants.js";
import { buildVideoPart } from "../lib/gemini.js";

export async function run(): Promise<void> {
  const uploadedPart = buildVideoPart(
    {
      kind: "uploaded_file",
      uploadedFile: {
        fileName: "files/test",
        fileUri: "https://example.com/file.mp4",
        mimeType: "video/mp4",
      },
    },
    {
      fps: 0.5,
      mediaResolution: LOW_MEDIA_RESOLUTION,
      startOffsetSeconds: 10,
      endOffsetSeconds: 20,
    }
  );

  assert.deepEqual(uploadedPart.mediaResolution, { level: LOW_MEDIA_RESOLUTION });
  assert.deepEqual(uploadedPart.videoMetadata, {
    startOffset: "10s",
    endOffset: "20s",
    fps: 0.5,
  });

  const urlPart = buildVideoPart(
    { kind: "youtube_url", normalizedYoutubeUrl: "https://www.youtube.com/watch?v=test" },
    { mediaResolution: LOW_MEDIA_RESOLUTION }
  );

  assert.equal(urlPart.mediaResolution, undefined);
}
