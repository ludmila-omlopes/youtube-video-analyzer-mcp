# YouTube Video Analyzer MCP

MCP stdio server for analyzing public YouTube videos with Google Gemini.

Use it from any MCP-compatible client to summarize videos, extract timestamped insights, analyze spoken content, inspect metadata, work with long VODs, and ask follow-up questions against reusable long-video sessions.

## What It Can Do

- Analyze public YouTube videos with Gemini.
- Analyze speech-focused videos with audio-first instructions.
- Fetch normalized YouTube metadata through the YouTube Data API.
- Extract high-resolution JPEG frames from YouTube videos with `yt-dlp` and `ffmpeg`.
- Analyze long videos and VODs through required MCP tasks.
- Analyze long videos and VODs through compatibility background jobs for clients without MCP task support.
- Reuse long-video sessions for follow-up questions.
- Fall back to URL chunking when local download tools are unavailable.
- Return structured JSON when you provide a custom response schema.

## Requirements

- Node.js 20 or newer.
- A Gemini API key.
- Optional: a YouTube Data API key for metadata lookup.
- Optional for best long-video support: `yt-dlp` and `ffmpeg`.

## Quick Start

Use the published package directly from your MCP client with `npx`:

```json
{
  "mcpServers": {
    "youtube-analyzer": {
      "command": "npx",
      "args": ["-y", "@ludylops/youtube-video-analyzer-mcp"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_key_here",
        "YOUTUBE_API_KEY": "optional_youtube_key_here"
      }
    }
  }
}
```

`GEMINI_API_KEY` is required. `YOUTUBE_API_KEY` is only required for `get_youtube_video_metadata`.

## Global Setup

You can also install the package globally and store reusable config:

```bash
npm install -g @ludylops/youtube-video-analyzer-mcp
youtube-video-analyzer-mcp setup
```

Then your MCP client can use:

```json
{
  "mcpServers": {
    "youtube-analyzer": {
      "command": "youtube-video-analyzer-mcp"
    }
  }
}
```

## Packages

This repository is a small npm workspace:

- `@ludylops/video-analysis-core`: reusable transport-agnostic video analysis logic in `packages/video-analysis-core`.
- `@ludylops/youtube-video-analyzer-mcp`: MCP stdio server adapter in the repository root.

The MCP server depends on the core package, so SaaS apps, CLIs, skills, and other integrations can reuse the same analysis logic without depending on MCP.

## Local Development

```bash
npm install
npm run build
npm test
npm start
```

Copy `.env.example` to `.env` for local runs:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
YOUTUBE_API_KEY=your_youtube_api_key_here
GEMINI_MODEL=gemini-2.5-pro
YT_DLP_PATH=yt-dlp
MCP_LOG_LEVEL=warn
```

## Tools

- `get_youtube_analyzer_capabilities`: inspects local support for long-video strategies.
- `get_youtube_video_metadata`: fetches normalized public YouTube metadata.
- `get_youtube_video_frame`: extracts a high-resolution JPEG frame at a timestamp.
- `analyze_youtube_video`: analyzes short videos or bounded clip windows.
- `analyze_youtube_video_audio`: analyzes speech-focused videos using audio-first instructions.
- `analyze_long_youtube_video`: analyzes long videos or VODs as a required MCP task.
- `start_long_youtube_analysis`: starts a background long-video job and returns a `jobId`.
- `get_long_youtube_analysis_status`: polls a background long-video job.
- `get_long_youtube_analysis_result`: fetches a completed background long-video job result.
- `cancel_long_youtube_analysis`: cancels a background long-video job.
- `continue_long_video_analysis`: asks follow-up questions for a previous long-video session as a required MCP task.

For detailed inputs, strategies, and examples, see [docs/tools.md](docs/tools.md).

## Long Videos

For VODs and long videos, call `get_youtube_analyzer_capabilities` first.

The native long-video tools require MCP task execution. If your client only supports synchronous tool calls with a fixed timeout such as 120 seconds, use the compatibility job workflow: `start_long_youtube_analysis`, poll `get_long_youtube_analysis_status`, then fetch `get_long_youtube_analysis_result`. You can also analyze shorter bounded windows with `analyze_youtube_video`.

When `yt-dlp`, `ffmpeg`, and a writable temp directory are available, use `analyze_long_youtube_video` with `strategy=auto` or `strategy=uploaded_file`. This path can create a reusable Gemini file session and return a `sessionId`.

When local download tools are unavailable, use `strategy=url_chunks`. It avoids local media downloads, but can require more Gemini calls.

Read the full guide in [docs/long-videos.md](docs/long-videos.md).

## Documentation

- [Installation](docs/installation.md)
- [Configuration](docs/configuration.md)
- [Tools](docs/tools.md)
- [Long videos](docs/long-videos.md)
- [Examples](docs/examples.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release process](docs/release-process.md)
- [Changelog](CHANGELOG.md)

## Privacy And Limitations

This server sends the YouTube URL, prompts, and relevant media or derived chunks to Google Gemini. With `strategy=uploaded_file`, local tools may download temporary media before uploading it to Gemini. `get_youtube_video_frame` downloads a small temporary high-quality video window and returns a JPEG frame. With `strategy=url_chunks`, the server avoids local media downloads but may make more Gemini calls.

Private, deleted, age-restricted, member-only, DRM-protected, or region-blocked videos may fail depending on YouTube and Gemini access. Users are responsible for complying with YouTube terms, Gemini API terms, copyright rules, and local law.

## Project Layout

- `packages/video-analysis-core/src`: reusable video analysis core.
- `src/server.ts`: MCP server and tool registration.
- `src/mcp-server-main.ts`: stdio transport entry point.
- `src/platform-runtime`: runtime adapters used by the MCP server.
- `bin/youtube-video-analyzer-mcp.js`: CLI wrapper and setup flow.
- `src/test`: test suite.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), run `npm test` before opening changes, and update [CHANGELOG.md](CHANGELOG.md) for user-visible behavior changes.

## License

MIT. See [LICENSE](LICENSE).
