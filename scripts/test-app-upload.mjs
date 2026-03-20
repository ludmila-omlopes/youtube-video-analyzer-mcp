import "dotenv/config";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAiClient, uploadVideoFile } from "../dist/lib/gemini.js";

const logger = {
  requestId: "upload-smoke",
  tool: "upload-smoke",
  child: () => logger,
  info: (...args) => console.error("INFO", ...args),
  warn: (...args) => console.error("WARN", ...args),
  error: (...args) => console.error("ERROR", ...args),
};

const ai = createAiClient();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "upload-helper-test-"));
const filePath = path.join(tempDir, "sample.txt");
await fs.writeFile(filePath, "hello from helper upload test\n", "utf8");

try {
  const result = await uploadVideoFile(
    ai,
    {
      filePath,
      mimeType: "text/plain",
      tempDir,
    },
    {
      logger,
      tool: "upload-smoke",
      uploadFailureMessage: "upload failed",
      processingFailureMessage: "processing failed",
      uploadTimeoutMs: 30000,
    }
  );

  console.log(JSON.stringify(result, null, 2));
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
