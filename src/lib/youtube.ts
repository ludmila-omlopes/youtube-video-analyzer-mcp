import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { YT_DLP_DEFAULT_FORMAT, YT_DLP_OUTPUT_TEMPLATE } from "./constants.js";
import type { DownloadedVideo, LongVideoStrategy } from "./types.js";

const execFileAsync = promisify(execFile);
const TRANSIENT_DOWNLOAD_EXTENSIONS = new Set([".part", ".temp", ".ytdl"]);

type CommandOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type LongVideoRuntimeCapabilities = {
  supported: boolean;
  strategyRequested: LongVideoStrategy;
  ytDlpAvailable: boolean;
  ffmpegAvailable: boolean;
  tempDirWritable: boolean;
  ytDlpCommand: string;
};

function normalizePotentialUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

export function normalizeYouTubeUrl(value: string): string | null {
  try {
    const url = new URL(normalizePotentialUrl(value));
    const hostname = url.hostname.toLowerCase();
    const supportedHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

    if (!supportedHosts.has(hostname)) {
      return null;
    }

    let videoId = "";
    if (hostname === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else {
      const segments = url.pathname.split("/").filter(Boolean);
      if (["live", "shorts", "embed"].includes(segments[0] ?? "")) {
        videoId = segments[1] ?? "";
      }
    }

    if (!videoId) {
      return null;
    }

    const canonicalUrl = new URL("https://www.youtube.com/watch");
    canonicalUrl.searchParams.set("v", videoId);
    return canonicalUrl.toString();
  } catch {
    return null;
  }
}

function getYtDlpCommand(): { command: string; args: string[] } {
  if (process.env.YT_DLP_PATH) {
    return { command: process.env.YT_DLP_PATH, args: [] };
  }

  return { command: "python", args: ["-m", "yt_dlp"] };
}

function getMimeTypeFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".m4v": "video/x-m4v",
  };

  return mimeTypes[extension] || "video/mp4";
}

function hasAdaptiveFragments(files: string[]): boolean {
  return files.some((fileName) => /^source\.f\d+\.[^.]+$/i.test(fileName));
}

export function selectDownloadedVideoFile(files: string[]): string | null {
  const finalizedCandidates = files.filter((fileName) => {
    if (!/^source\.[^.]+$/i.test(fileName)) {
      return false;
    }

    if (/^source\.f\d+\.[^.]+$/i.test(fileName)) {
      return false;
    }

    return !TRANSIENT_DOWNLOAD_EXTENSIONS.has(path.extname(fileName).toLowerCase());
  });

  if (finalizedCandidates.length === 0) {
    return null;
  }

  const preferredExtensions = [".mp4", ".m4v", ".webm", ".mkv", ".mov", ".avi"];
  for (const extension of preferredExtensions) {
    const match = finalizedCandidates.find((fileName) => fileName.toLowerCase().endsWith(extension));
    if (match) {
      return match;
    }
  }

  return finalizedCandidates[0] ?? null;
}

async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      timeout: options.timeoutMs,
      signal: options.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown process execution error.";
    throw new Error(`Failed to run ${command}: ${message}`);
  }
}

async function isCommandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await runCommand(command, args, { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function isTempDirWritable(): Promise<boolean> {
  let tempDir: string | null = null;

  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-analyzer-capability-"));
    return true;
  } catch {
    return false;
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function formatYtDlpSectionTimestamp(seconds: number): string {
  return seconds.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

async function resolveDownloadedVideo(tempDir: string): Promise<DownloadedVideo> {
  const files = await fs.readdir(tempDir);
  const matchingFile = selectDownloadedVideoFile(files);
  if (!matchingFile) {
    if (hasAdaptiveFragments(files)) {
      throw new Error(
        "yt-dlp downloaded separate adaptive streams but did not produce a finalized combined file. ffmpeg may be missing."
      );
    }

    throw new Error("yt-dlp finished without creating a finalized downloadable video file.");
  }

  const filePath = path.join(tempDir, matchingFile);
  const stats = await fs.stat(filePath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error("yt-dlp finished without producing a non-empty finalized video file.");
  }

  return { filePath, mimeType: getMimeTypeFromPath(filePath), tempDir };
}

async function downloadWithYtDlp(
  normalizedYoutubeUrl: string,
  extraArgs: string[],
  tempPrefix: string,
  options: CommandOptions = {}
): Promise<DownloadedVideo> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const outputTemplate = path.join(tempDir, YT_DLP_OUTPUT_TEMPLATE);

  try {
    const ytDlp = getYtDlpCommand();
    await runCommand(
      ytDlp.command,
      [
        ...ytDlp.args,
        "--no-warnings",
        "--no-playlist",
        "--format",
        YT_DLP_DEFAULT_FORMAT,
        ...extraArgs,
        "--output",
        outputTemplate,
        normalizedYoutubeUrl,
      ],
      options
    );

    return await resolveDownloadedVideo(tempDir);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function downloadYouTubeVideo(
  normalizedYoutubeUrl: string,
  options: CommandOptions = {}
): Promise<DownloadedVideo> {
  return downloadWithYtDlp(normalizedYoutubeUrl, [], "youtube-analyzer-", options);
}

export async function downloadYouTubeVideoSegment(
  normalizedYoutubeUrl: string,
  startOffsetSeconds: number,
  endOffsetSeconds: number,
  options: CommandOptions = {}
): Promise<DownloadedVideo> {
  if (!(endOffsetSeconds > startOffsetSeconds)) {
    throw new Error("endOffsetSeconds must be greater than startOffsetSeconds for segment download.");
  }

  return downloadWithYtDlp(
    normalizedYoutubeUrl,
    [
      "--download-sections",
      `*${formatYtDlpSectionTimestamp(startOffsetSeconds)}-${formatYtDlpSectionTimestamp(endOffsetSeconds)}`,
      "--force-keyframes-at-cuts",
    ],
    "youtube-analyzer-segment-",
    options
  );
}

export async function getLongVideoRuntimeCapabilities(
  strategyRequested: LongVideoStrategy
): Promise<LongVideoRuntimeCapabilities> {
  const ytDlp = getYtDlpCommand();
  const ytDlpAvailable = await isCommandAvailable(ytDlp.command, [...ytDlp.args, "--version"]);
  const ffmpegAvailable = strategyRequested === "url_chunks" ? true : await isCommandAvailable("ffmpeg", ["-version"]);
  const tempDirWritable = strategyRequested === "url_chunks" ? true : await isTempDirWritable();

  return {
    supported: ytDlpAvailable && ffmpegAvailable && tempDirWritable,
    strategyRequested,
    ytDlpAvailable,
    ffmpegAvailable,
    tempDirWritable,
    ytDlpCommand: [ytDlp.command, ...ytDlp.args].join(" "),
  };
}
