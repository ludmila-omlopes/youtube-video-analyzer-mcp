# YouTube Video Analyzer MCP

An MCP server for analyzing public YouTube videos with Google Gemini. The package keeps its local `stdio` npm entrypoint for registry and desktop-client usage, and also includes a public Streamable HTTP adapter for Vercel-style deployment.

## Features

- `analyze_youtube_video` for direct short-video or manual-clip analysis
- `analyze_youtube_video_audio` for audio-only, transcript-grounded analysis of a public YouTube video
- `analyze_long_youtube_video` for long videos with Files API-first handling and URL-chunk fallback
- `continue_long_video_analysis` for follow-up questions on a long-video `sessionId`
- `get_youtube_video_metadata` for normalized public YouTube video metadata via the YouTube Data API
- Automatic YouTube URL normalization for `watch`, `live`, `shorts`, `embed`, and `youtu.be` links
- Structured JSON output in the video's detected dominant language by default
- MCP-native `structuredContent` responses with JSON text preserved in `content` for compatibility
- Structured stderr logging with request correlation IDs for long-running tool diagnostics
- Safe MCP error payloads with machine-readable `code`, `stage`, and strategy metadata
- Optional custom JSON schema support for final outputs
- Shared transport-neutral analysis service used by both `stdio` and HTTP adapters
- Public remote MCP route at `api/mcp.ts`

## Project layout

- `src/index.ts`: `stdio` bootstrap only
- `src/server.ts`: shared MCP tool registration, request logging, and task wiring
- `src/app/video-analysis-service.ts`: transport-neutral application service
- `src/app/session-store.ts`: session store contract plus in-memory implementation
- `src/app/create-service.ts`: local and cloud service factories
- `src/app/create-public-remote-service.ts`: public remote HTTP service factory
- `src/http/mcp.ts`: web-standard Streamable HTTP adapter
- `src/dev/hosted.ts`: local hosted-dev HTTP server for `/` and `/api/mcp`
- `api/mcp.ts`: Vercel route wrapper
- `src/lib/schemas.ts`: input and output schemas plus JSON helpers
- `src/lib/youtube.ts`: YouTube URL normalization and `yt-dlp` helpers
- `src/lib/gemini.ts`: Gemini request builders, uploads, token budgeting, caching, and retry handling
- `src/lib/analysis.ts`: short-video, long-video, and follow-up orchestration
- `src/lib/logger.ts`: structured stderr logging helpers
- `src/lib/errors.ts`: safe diagnostic error types and retryability heuristics

## Prerequisites

- Node.js 20+
- A Gemini API key
- A YouTube Data API key for the metadata tool
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

For the local hosted HTTP adapter:

```bash
npm run dev:hosted
```

For the built hosted HTTP adapter:

```bash
npm run build
npm run start:http
```

## Remote MCP on Vercel

The repository includes a public remote MCP entrypoint for web-standard Streamable HTTP:

- `api/mcp.ts`: Vercel route
- `src/http/mcp.ts`: shared HTTP handler

The HTTP adapter is public and reuses the same MCP tool registration logic from `src/server.ts`.

Remote deployment environment variables:

- `GEMINI_API_KEY`
- `YOUTUBE_API_KEY`

Remote runtime behavior:

- remote Gemini calls use the server-owned `GEMINI_API_KEY`
- remote metadata calls use the server-owned `YOUTUBE_API_KEY`
- remote MCP access is plug and play at `/api/mcp`
- remote `analyze_long_youtube_video` forces `strategy: "url_chunks"` to avoid download/upload work in the HTTP runtime
- remote long-video sessions remain in-memory and are only relevant for previously created uploaded-file sessions
- local `stdio` usage still uses environment variables and local config only

Important limitation for public HTTP deployments:

- `sessionId` is an opaque identifier sufficient for `continue_long_video_analysis`
- long-video sessions are volatile in the public HTTP mode
- restart, redeploy, expiration, or multi-instance routing can invalidate a previous `sessionId`

## Deploying on Render

The repository includes a `render.yaml` Blueprint for a single Render web service.

What it configures:

- build command: `npm ci && npm run build`
- start command: `npm run start:http`
- health check path: `/healthz`
- required secrets: `GEMINI_API_KEY`, `YOUTUBE_API_KEY`
- graceful shutdown window: `120` seconds for redeploys

Render-specific runtime behavior in this repo:

- the hosted HTTP server binds to `0.0.0.0:$PORT` when Render injects `PORT`
- the root route reports the public MCP URL using Render's forwarded host/protocol headers
- `analyze_long_youtube_video` still forces `strategy: "url_chunks"` in remote HTTP mode, so Render does not need local `yt-dlp` or `ffmpeg` for the public web service path

Recommended plan choice:

- the sample Blueprint uses `plan: free` to avoid creating a paid service by default
- for production MCP usage, change the service plan to `starter` or higher so the service stays warm and long requests are less likely to be impacted by free-tier sleep behavior

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

### Local `stdio`

Replace the example path below with the absolute path to your own built `dist/index.js` file.

```json
{
  "mcpServers": {
    "youtube-analyzer": {
      "command": "npx",
      "args": ["-y", "@ludylops/youtube-video-analyzer-mcp"],
      "env": {
        "GEMINI_API_KEY": "your_gemini_api_key_here",
        "YOUTUBE_API_KEY": "your_youtube_api_key_here",
        "GEMINI_MODEL": "gemini-2.5-pro",
        "YT_DLP_PATH": "yt-dlp"
      }
    }
  }
}
```

### Public remote HTTP

```json
{
  "mcpServers": {
    "youtube-analyzer-remote": {
      "url": "https://your-deployment.example.com/api/mcp"
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

### `analyze_youtube_video_audio`

Inputs:

- `youtubeUrl`: public YouTube URL in `watch`, `live`, `shorts`, `embed`, or `youtu.be` form
- `analysisPrompt`: optional analysis focus
- `startOffsetSeconds`: optional clip start
- `endOffsetSeconds`: optional clip end
- `model`: optional Gemini model override, default `gemini-3-flash-preview`
- `responseSchemaJson`: optional JSON schema string for custom structured output

Behavior:

- Uses Gemini's audio-understanding prompting pattern against the public YouTube URL
- Instructs Gemini to ignore visual-only evidence and analyze only spoken content, audible cues, and short transcript excerpts
- Returns structured JSON with transcript-grounded analysis by default

Success output:

- `content[0].text`: pretty-printed JSON for compatibility with text-only clients
- `structuredContent`: the same parsed object validated against the tool output schema

### `get_youtube_video_metadata`

Inputs:

- `youtubeUrl`: public YouTube URL in `watch`, `live`, `shorts`, `embed`, or `youtu.be` form

Behavior:

- Uses the YouTube Data API `videos.list` endpoint, not Gemini
- Normalizes supported URLs to a canonical `https://www.youtube.com/watch?v=...` URL
- Requires `YOUTUBE_API_KEY` in the runtime environment or local user config
- Returns normalized metadata fields with `null` or empty arrays for missing public fields

Success output:

- `content[0].text`: pretty-printed JSON for compatibility with text-only clients
- `structuredContent`: normalized public video metadata validated against the tool output schema

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
- public remote HTTP: forces `url_chunks` regardless of the requested strategy

Behavior:

- Uses `yt-dlp` to resolve duration metadata for long videos when available, with a watch-page fallback for public videos in cloud-style runtimes
- In local `stdio`, `auto` prefers uploaded-file analysis before trying direct URL chunks
- In public remote HTTP, long-video analysis skips the uploaded-file path and runs `url_chunks`
- Returns a `sessionId` when an uploaded-file session is created successfully
- Emits structured stderr logs for strategy choice, chunk progress, retries, fallbacks, and failures
- Returns `structuredContent` on success and `isError: true` on handled runtime failures

### `continue_long_video_analysis`

Inputs:

- `sessionId`: session returned by `analyze_long_youtube_video`
- `analysisPrompt`: follow-up prompt
- `model`: optional model override
- `responseSchemaJson`: optional JSON schema string for structured follow-up output

## Notes

- The server uses the current MCP `registerTool(...)` API and supports both local `stdio` and remote Streamable HTTP adapters.
- The server normalizes supported YouTube URL formats into a canonical `https://www.youtube.com/watch?v=...` URL before sending the request to Gemini.
- `get_youtube_video_metadata` uses the YouTube Data API and does not call Gemini.
- If `YT_DLP_PATH` is not set, the server will try `python -m yt_dlp` automatically.
- Cache reuse is an optimization for repeated analysis on the same uploaded asset; it does not increase the effective model context window.
- Local `stdio` sessions use an in-memory store by default.
- Public HTTP deployments use a shared in-memory cloud session store and expose `/api/mcp` without additional authentication.
