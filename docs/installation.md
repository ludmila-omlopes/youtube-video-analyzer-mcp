# Installation

This package runs as an MCP stdio server. Most users should connect it to an MCP-compatible client with `npx`.

## Requirements

- Node.js 20 or newer.
- A Gemini API key.
- Optional: a YouTube Data API key for metadata lookup.
- Optional for best long-video support: `yt-dlp` and `ffmpeg`.

## Recommended MCP Client Config

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

`GEMINI_API_KEY` is required for analysis tools. `YOUTUBE_API_KEY` is optional and only needed by `get_youtube_video_metadata`.

## Global Install

```bash
npm install -g @ludylops/youtube-video-analyzer-mcp
youtube-video-analyzer-mcp setup
```

The `setup` command stores reusable config in the user config directory. After setup, your MCP client can use:

```json
{
  "mcpServers": {
    "youtube-analyzer": {
      "command": "youtube-video-analyzer-mcp"
    }
  }
}
```

## Local Development Install

```bash
git clone https://github.com/ludmila-omlopes/youtube-video-analyzer-mcp-server.git
cd youtube-video-analyzer-mcp-server
npm install
npm run build
npm test
```

Copy `.env.example` to `.env` and set at least `GEMINI_API_KEY`.

```bash
npm start
```

## Optional Long-Video Dependencies

For the strongest long-video path, install both:

- `yt-dlp`
- `ffmpeg`

When both are available, `analyze_long_youtube_video` can use `strategy=uploaded_file`, which downloads a temporary copy, uploads it to Gemini, and can return a reusable `sessionId`.

Without them, long videos can still use `strategy=url_chunks`, but that path can require more Gemini calls.
