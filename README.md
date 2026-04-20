# YouTube Video Analyzer MCP (stdio)

MCP **stdio** server for analyzing public YouTube videos with Google Gemini. This repository is the MCP-only extract from the platform monorepo: analysis logic lives in [`@ludylops/video-analysis-core`](https://github.com/ludmila-omlopes/youtube-analyzer-mcp/tree/main/packages/video-analysis-core) (consumed here via `file:` for local development or a published version in production).

## Layout

- Sibling clone expected: `../youtube-analyzer-mcp` (see `package.json` → `@ludylops/video-analysis-core`).
- After cloning, build core once from the monorepo: `npm run build -w @ludylops/video-analysis-core` (from `youtube-analyzer-mcp` root).

## Setup

```bash
npm install
npm run build
npm test
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (and optionally `YOUTUBE_API_KEY`, `GEMINI_MODEL`, `YT_DLP_PATH`).

## Run

```bash
npm run build
npm start
```

Or use the global-style setup flow from the `bin` entry (see `--help`).

## Publishing

1. Publish or version `@ludylops/video-analysis-core` and replace the `file:` dependency with a semver range.
2. Update `server.json` `repository.url` if the GitHub remote differs from this template.
3. `npm publish` and refresh MCP Registry metadata as needed.
