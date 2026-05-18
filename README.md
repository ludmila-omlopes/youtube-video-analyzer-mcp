# YouTube Video Analyzer MCP (stdio)

MCP **stdio** server for analyzing public YouTube videos with Google Gemini. The server logic is implemented directly in this repository.

## Layout

- Self-contained MCP server implementation in this repository (`src/core` + `src/server.ts`).

## Setup

```bash
npm install
npm run build
npm test
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (and optionally `YOUTUBE_API_KEY`, `GEMINI_MODEL`, `YT_DLP_PATH`, `MCP_LOG_LEVEL`).

## Run

```bash
npm run build
npm start
```

Or use the global-style setup flow from the `bin` entry (see `--help`).

`MCP_LOG_LEVEL` defaults to `warn` to keep stdio output quieter (`info` for verbose logs, `silent` to suppress non-error logs).

## Publishing

1. Update `server.json` `repository.url` if the GitHub remote differs from this template.
2. `npm publish` and refresh MCP Registry metadata as needed.
