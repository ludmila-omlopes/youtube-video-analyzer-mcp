import "dotenv/config";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-upload-test-"));
const filePath = path.join(tempDir, "sample.txt");
await fs.writeFile(filePath, "hello from upload test\n", "utf8");

async function runCase(label, config) {
  try {
    const result = await ai.files.upload({
      file: filePath,
      config: {
        mimeType: "text/plain",
        displayName: `upload-test-${label}`,
        ...config,
      },
    });
    console.log(label, "OK", JSON.stringify({ name: result.name, uri: result.uri, mimeType: result.mimeType }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(label, "ERR", message);
  }
}

await runCase("no_http_options", {});
await runCase("with_timeout_http_options", { httpOptions: { timeout: 30000 } });
await runCase("with_abort_only", { abortSignal: new AbortController().signal });

await fs.rm(tempDir, { recursive: true, force: true });
