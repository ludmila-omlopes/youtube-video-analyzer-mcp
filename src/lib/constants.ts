import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const SERVER_INFO = {
  name: "youtube-analyzer-gemini",
  version: "0.2.0",
} as const;

export const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
export const DEFAULT_AUDIO_ANALYSIS_MODEL = "gemini-3-flash-preview";
export const DEFAULT_LONG_VIDEO_CHUNK_MODEL = "gemini-2.5-flash";
export const DEFAULT_LONG_VIDEO_FINAL_MODEL = "gemini-2.5-pro";
export const DEFAULT_CHUNK_OVERLAP_SECONDS = 5;
export const MIN_CHUNK_DURATION_SECONDS = 30;
export const DEFAULT_CACHE_TTL_SECONDS = 86_400;
export const DEFAULT_TASK_TTL_MS = Number(process.env.MCP_TASK_TTL_MS || 30 * 60 * 1000);
export const TOKEN_BUDGET_RATIO = 0.7;
export const TOKEN_BUDGET_FPS_CANDIDATES = [1, 0.5, 0.25] as const;
export const YT_DLP_OUTPUT_TEMPLATE = "source.%(ext)s";
export const YT_DLP_DEFAULT_FORMAT = "b[height<=480][ext=mp4]/b[height<=480]/b[ext=mp4]/b";
export const LOW_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_LOW" as const;
export const ALLOW_GEMINI_TEXT_JSON_FALLBACK = process.env.GEMINI_TEXT_JSON_FALLBACK === "true";

export const METADATA_TIMEOUT_MS = Number(process.env.YOUTUBE_METADATA_TIMEOUT_MS || 60_000);
export const DOWNLOAD_TIMEOUT_MS = Number(process.env.YOUTUBE_DOWNLOAD_TIMEOUT_MS || 15 * 60_000);
export const FILE_UPLOAD_TIMEOUT_MS = Number(process.env.GEMINI_FILE_UPLOAD_TIMEOUT_MS || 15 * 60_000);
export const FILE_PROCESSING_DEADLINE_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_DEADLINE_MS || 20 * 60_000
);
export const FILE_PROCESSING_POLL_INTERVAL_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_POLL_INTERVAL_MS || 2_000
);
export const TOKEN_COUNT_TIMEOUT_MS = Number(process.env.GEMINI_TOKEN_COUNT_TIMEOUT_MS || 60_000);
export const CACHE_CREATE_TIMEOUT_MS = Number(process.env.GEMINI_CACHE_CREATE_TIMEOUT_MS || 60_000);
export const GENERATION_TIMEOUT_MS = Number(process.env.GEMINI_GENERATION_TIMEOUT_MS || 10 * 60_000);
export const SYNTHESIS_TIMEOUT_MS = Number(process.env.GEMINI_SYNTHESIS_TIMEOUT_MS || 10 * 60_000);

export const MODEL_INPUT_TOKEN_LIMITS: Record<string, number> = {
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-flash-lite": 1_048_576,
  "gemini-3.1-pro-preview": 1_048_576,
  "gemini-3-flash-preview": 1_048_576,
  "gemini-3.1-flash-lite-preview": 1_048_576,
};

export const USER_CONFIG_DIR_NAME = "youtube-video-analyzer-mcp";
export const RUNTIME_ENV_KEYS = ["GEMINI_API_KEY", "YOUTUBE_API_KEY", "GEMINI_MODEL", "YT_DLP_PATH"] as const;

export type RuntimeEnvKey = (typeof RUNTIME_ENV_KEYS)[number];
export type UserConfig = Partial<Record<RuntimeEnvKey, string>>;

type ConfigPathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
};

function sanitizeConfigValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function getUserConfigPath(options: ConfigPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();

  if (platform === "win32") {
    const baseDir = env.APPDATA || path.win32.join(homedir, "AppData", "Roaming");
    return path.win32.join(baseDir, USER_CONFIG_DIR_NAME, "config.json");
  }

  const baseDir = env.XDG_CONFIG_HOME || path.posix.join(homedir, ".config");
  return path.posix.join(baseDir, USER_CONFIG_DIR_NAME, "config.json");
}

export async function readUserConfigFile(configPath: string): Promise<UserConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Config file must contain a JSON object.");
    }

    const config: UserConfig = {};
    for (const key of RUNTIME_ENV_KEYS) {
      const value = sanitizeConfigValue(parsed[key]);
      if (value) {
        config[key] = value;
      }
    }

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read config file at ${configPath}: ${message}`);
  }
}

export function applyUserConfigToEnv(config: UserConfig, env: NodeJS.ProcessEnv = process.env): void {
  for (const key of RUNTIME_ENV_KEYS) {
    if (!env[key] && config[key]) {
      env[key] = config[key];
    }
  }
}

export async function writeUserConfigFile(configPath: string, config: UserConfig): Promise<void> {
  const cleanedConfig = Object.fromEntries(
    RUNTIME_ENV_KEYS.map((key) => [key, sanitizeConfigValue(config[key])]).filter(
      (entry): entry is [RuntimeEnvKey, string] => Boolean(entry[1])
    )
  );

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(cleanedConfig, null, 2)}\n`, "utf8");
}

export function formatMissingApiKeyGuidance(configPath: string): string {
  return [
    "Missing GEMINI_API_KEY.",
    "",
    "Set it in one of these ways:",
    "1. Run `youtube-video-analyzer-mcp setup` to create a user config file.",
    "2. Pass it in your MCP client `env` configuration.",
    "3. Export it in your shell before starting the server.",
    "",
    `User config path: ${configPath}`,
    "",
    "Example MCP config:",
    "{",
    '  "mcpServers": {',
    '    "youtube-analyzer": {',
    '      "command": "npx",',
    '      "args": ["-y", "@ludylops/youtube-video-analyzer-mcp"],',
    '      "env": {',
    '        "GEMINI_API_KEY": "your_key_here"',
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
}
