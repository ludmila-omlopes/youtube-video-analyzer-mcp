import "dotenv/config";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { YT_DLP_DEFAULT_FORMAT, YT_DLP_OUTPUT_TEMPLATE } from "../dist/lib/constants.js";

const execFileAsync = promisify(execFile);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-download-diagnose-"));
const outputTemplate = path.join(tempDir, YT_DLP_OUTPUT_TEMPLATE);
const command = process.env.YT_DLP_PATH || "python";
const args = process.env.YT_DLP_PATH
  ? [
      "--no-warnings",
      "--no-playlist",
      "--format",
      YT_DLP_DEFAULT_FORMAT,
      "--merge-output-format",
      "mp4",
      "--output",
      outputTemplate,
      "https://www.youtube.com/watch?v=z_e0BUag1V4",
    ]
  : [
      "-m",
      "yt_dlp",
      "--no-warnings",
      "--no-playlist",
      "--format",
      YT_DLP_DEFAULT_FORMAT,
      "--merge-output-format",
      "mp4",
      "--output",
      outputTemplate,
      "https://www.youtube.com/watch?v=z_e0BUag1V4",
    ];

console.log("TEMP_DIR", tempDir);
console.log("COMMAND", command);
console.log("ARGS", JSON.stringify(args));

try {
  const { stdout, stderr } = await execFileAsync(command, args, {
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 15 * 60_000,
  });
  console.log("EXIT", "OK");
  if (stdout.trim()) console.log("STDOUT", stdout);
  if (stderr.trim()) console.log("STDERR", stderr);
} catch (error) {
  console.log("EXIT", "ERR", error?.message ?? String(error));
  if (error?.stdout) console.log("STDOUT", error.stdout);
  if (error?.stderr) console.log("STDERR", error.stderr);
}

const files = await fs.readdir(tempDir);
console.log("FILES", JSON.stringify(files));
for (const file of files) {
  const filePath = path.join(tempDir, file);
  const stats = await fs.stat(filePath);
  console.log("FILE", JSON.stringify({ file, size: stats.size }));
}

