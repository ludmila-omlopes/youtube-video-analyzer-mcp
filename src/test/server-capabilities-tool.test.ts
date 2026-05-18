import assert from "node:assert/strict";

import { createServer } from "../server.js";
import { createConnectedInMemoryClient } from "./test-helpers.js";

export async function run(): Promise<void> {
  const server = createServer({
    capabilitiesProvider: async () => ({
      supported: false,
      strategyRequested: "uploaded_file",
      ytDlpAvailable: false,
      ffmpegAvailable: false,
      tempDirWritable: true,
      ytDlpCommand: "python -m yt_dlp",
    }),
    service: {
      async analyzeShort() {
        throw new Error("Not used");
      },
      async analyzeAudio() {
        throw new Error("Not used");
      },
      async analyzeLong() {
        throw new Error("Not used");
      },
      async continueLong() {
        throw new Error("Not used");
      },
      async getYouTubeMetadata() {
        throw new Error("Not used");
      },
    },
  });

  const client = await createConnectedInMemoryClient(server);

  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "get_youtube_analyzer_capabilities"));

    const result = await client.callTool({
      name: "get_youtube_analyzer_capabilities",
      arguments: {},
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
      transport: "stdio",
      mcpToolDeadlineMs: 110000,
      supportsMcpTasks: true,
      ytDlpAvailable: false,
      ffmpegAvailable: false,
      tempDirWritable: true,
      ytDlpCommand: "python -m yt_dlp",
      recommendedLongVideoStrategy: "url_chunks",
      recommendedWorkflow: [
        "Use get_youtube_analyzer_capabilities before long VOD analysis.",
        "Use analyze_youtube_video for short videos or bounded clips.",
        "Use analyze_long_youtube_video for VODs and long videos; this server exposes it as an MCP task.",
        "For long videos, use strategy=url_chunks until yt-dlp and ffmpeg are available.",
        "Use continue_long_video_analysis only with a sessionId returned by analyze_long_youtube_video.",
      ],
      notes: [
        "timeoutSeconds controls internal Gemini generation calls, not the MCP client's outer timeout.",
        "uploaded_file requires yt-dlp, ffmpeg, and a writable temp directory.",
        "url_chunks does not require local download tools, but can require many Gemini calls for long VODs.",
      ],
    });
  } finally {
    await client.close();
    await server.close();
  }
}
