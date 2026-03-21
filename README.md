# YouTube Video Analyzer MCP

An MCP `stdio` server that uses Google Gemini to analyze public YouTube videos by attaching the YouTube URL as video input instead of only mentioning it in prompt text.

## Features

- `analyze_youtube_video` for direct short-video or manual-clip analysis
- `analyze_long_youtube_video` for long videos with Files API-first long-video handling and URL-chunk fallback
- `continue_long_video_analysis` for follow-up questions on an uploaded long-video session
- Automatic YouTube URL normalization for `watch`, `live`, `shorts`, `embed`, and `youtu.be` links
- Structured JSON output in the video's detected dominant language by default
- MCP-native `structuredContent` responses with JSON text preserved in `content` for compatibility
- Structured stderr logging with request correlation IDs for long-running tool diagnostics
- Safe MCP error payloads with machine-readable `code`, `stage`, and strategy metadata
- Optional custom JSON schema support for final outputs
- `youtube-video-analyzer-mcp setup` for saving user-level config when using the npm package directly

## Project layout

- `src/index.ts`: `stdio` bootstrap only
- `src/server.ts`: MCP server creation, request logging, and `registerTool(...)` wiring
- `src/lib/schemas.ts`: input and output schemas plus JSON helpers
- `src/lib/youtube.ts`: YouTube URL normalization and `yt-dlp` helpers
- `src/lib/gemini.ts`: Gemini request builders, uploads, token budgeting, caching, and retry handling
- `src/lib/analysis.ts`: short-video, long-video, and follow-up orchestration with in-memory sessions
- `src/lib/logger.ts`: structured stderr logging helpers
- `src/lib/errors.ts`: safe diagnostic error types and retryability heuristics

## Prerequisites

- Node.js 20+
- A Gemini API key
- A public YouTube video URL
- `yt-dlp` installed locally for the long-video tool, either as a binary or via `python -m yt_dlp`
- `ffmpeg` if your `yt-dlp` setup needs it to merge adaptive video/audio downloads

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and add your API key:

   ```bash
   copy .env.example .env
   ```

3. Optionally point to a custom `yt-dlp` binary if it is not on your `PATH`.

4. Build the server:

   ```bash
   npm run build
   ```

## Running locally

For normal local development:

```bash
npm run dev
```

For the built package entrypoint behavior:

```bash
npm run build
npm start
```

## Using the npm package

Run it without installing globally:

```bash
npx -y @ludylops/youtube-video-analyzer-mcp
```

Or install it globally:

```bash
npm install -g @ludylops/youtube-video-analyzer-mcp
youtube-video-analyzer-mcp
```

To save your API key and optional defaults in a user config file:

```bash
youtube-video-analyzer-mcp setup
```

The setup command writes a config file in the standard user config location:

- Windows: `%APPDATA%/youtube-video-analyzer-mcp/config.json`
- macOS/Linux: `~/.config/youtube-video-analyzer-mcp/config.json`

Config precedence is:

1. Explicit environment variables
2. Local `.env`
3. User config file created by `setup`
4. Built-in defaults

## MCP configuration example

Replace the example path below with the absolute path to your own built `dist/index.js` file.

```json
{
  "mcpServers": {
    "youtube-analyzer": {
      "command": "npx",
      "args": ["-y", "@ludylops/youtube-video-analyzer-mcp"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key_here",
        "GEMINI_MODEL": "gemini-2.5-pro",
        "YT_DLP_PATH": "yt-dlp"
      }
    }
  }
}
```

If you prefer a locally built checkout instead of npm, use `node` plus the absolute path to your own built `dist/index.js`.

## Tool behavior

### `analyze_youtube_video`

Inputs:

- `youtubeUrl`: public YouTube URL in `watch`, `live`, `shorts`, `embed`, or `youtu.be` form
- `analysisPrompt`: optional analysis focus
- `startOffsetSeconds`: optional clip start
- `endOffsetSeconds`: optional clip end
- `model`: optional Gemini model override
- `responseSchemaJson`: optional JSON schema string for custom structured output

Success output:

- `content[0].text`: pretty-printed JSON for compatibility with text-only clients
- `structuredContent`: the same parsed object validated against the tool output schema

### `analyze_long_youtube_video`

Inputs:

- `youtubeUrl`: public YouTube URL
- `analysisPrompt`: optional global analysis focus
- `chunkModel`: optional chunk-analysis model, default `gemini-2.5-flash`
- `finalModel`: optional final synthesis model, default `gemini-2.5-pro`
- `strategy`: optional `auto`, `url_chunks`, or `uploaded_file`
- `preferCache`: optional boolean, default `true`
- `responseSchemaJson`: optional JSON schema string for the final structured output

Strategy policy:

- `auto`: prefers uploaded-file analysis first, then falls back to URL chunks if needed
- `uploaded_file`: deterministic Files API path for long videos
- `url_chunks`: explicit preview-oriented path for public YouTube videos that avoids local download/upload work

Production guidance:

- Uploaded-file analysis is the recommended default for long videos because Gemini Files API is the documented path for larger and reusable media.
- URL chunking can still be useful when you want to avoid local download/upload work and the source video is public, but it depends on preview YouTube URL support and is not the primary production path.

Behavior:

- Uses `yt-dlp` to resolve duration metadata for long videos
- In `auto`, prefers uploaded-file analysis before trying direct URL chunks
- Returns a `sessionId` when an uploaded-file session is created successfully
- Emits structured stderr logs for strategy choice, chunk progress, retries, fallbacks, and failures
- Returns `structuredContent` on success and `isError: true` on handled runtime failures

Handled failure output:

- `error.tool`
- `error.requestId`
- `error.code`
- `error.stage`
- `error.message`
- `error.retryable`
- `error.strategyRequested`
- `error.strategyAttempted`
- `error.causeMessage`
- `error.details`

### `continue_long_video_analysis`

Inputs:

- `sessionId`: session returned by `analyze_long_youtube_video`
- `analysisPrompt`: follow-up prompt
- `model`: optional model override
- `responseSchemaJson`: optional JSON schema string for structured follow-up output

## Notes

- The server uses the current MCP `registerTool(...)` API and remains intentionally `stdio`-only in this project.
- Streamable HTTP is the modern remote transport, but adding it is out of scope for this server.
- The server normalizes supported YouTube URL formats into a canonical `https://www.youtube.com/watch?v=...` URL before sending the request to Gemini.
- If `YT_DLP_PATH` is not set, the server will try `python -m yt_dlp` automatically.
- Cache reuse is an optimization for repeated analysis on the same uploaded asset; it does not increase the effective model context window.
- Sessions are stored in memory only and disappear if the MCP server restarts.
