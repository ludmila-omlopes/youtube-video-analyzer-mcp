import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyUserConfigToEnv,
  formatMissingApiKeyGuidance,
  getUserConfigPath,
  readUserConfigFile,
  writeUserConfigFile,
} from "../lib/constants.js";
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

  assert.equal(
    getUserConfigPath({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\tester\\AppData\\Roaming" },
      homedir: "C:\\Users\\tester",
    }),
    "C:\\Users\\tester\\AppData\\Roaming\\youtube-video-analyzer-mcp\\config.json"
  );

  assert.equal(
    getUserConfigPath({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/tmp/config-home" },
      homedir: "/home/tester",
    }),
    "/tmp/config-home/youtube-video-analyzer-mcp/config.json"
  );

  const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: "already-set" };
  applyUserConfigToEnv(
    {
      GEMINI_API_KEY: "from-config",
      YOUTUBE_API_KEY: "youtube-from-config",
      GEMINI_MODEL: "gemini-2.5-pro",
      YT_DLP_PATH: "yt-dlp",
    },
    env
  );
  assert.equal(env.GEMINI_API_KEY, "already-set");
  assert.equal(env.YOUTUBE_API_KEY, "youtube-from-config");
  assert.equal(env.GEMINI_MODEL, "gemini-2.5-pro");
  assert.equal(env.YT_DLP_PATH, "yt-dlp");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-config-test-"));
  const configPath = path.join(tempDir, "config.json");

  try {
    await writeUserConfigFile(configPath, {
      GEMINI_API_KEY: "key-123",
      YOUTUBE_API_KEY: "youtube-key-456",
      GEMINI_MODEL: "gemini-2.5-pro",
      YT_DLP_PATH: "  ",
    });

    const config = await readUserConfigFile(configPath);
    assert.deepEqual(config, {
      GEMINI_API_KEY: "key-123",
      YOUTUBE_API_KEY: "youtube-key-456",
      GEMINI_MODEL: "gemini-2.5-pro",
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  const guidance = formatMissingApiKeyGuidance("/tmp/youtube-video-analyzer-mcp/config.json");
  assert.match(guidance, /youtube-video-analyzer-mcp setup/);
  assert.match(guidance, /GEMINI_API_KEY/);
  assert.match(guidance, /\/tmp\/youtube-video-analyzer-mcp\/config\.json/);
}
