# AGENTS.md

## Purpose

This repository is a TypeScript ESM MCP `stdio` server for analyzing public YouTube videos with Google Gemini. Keep changes small, testable, and easy to reason about. Prefer thin wiring layers, focused library modules, and deterministic unit tests.

## Documentation-First Areas

Before suggesting or shipping changes in the areas below, check the original documentation instead of relying on memory:

- `@google/genai`
  - YouTube/video request shapes
  - `fileData.fileUri` handling
  - `videoMetadata` clipping and FPS behavior
  - Files API upload and processing lifecycle
  - cache APIs
  - structured JSON generation requirements and model support
  - token counting limits, model capabilities, and timeout behavior
- `@modelcontextprotocol/sdk`
  - especially `server.registerTool(...)`
  - `server.experimental.tasks.registerToolTask(...)`
  - task store semantics, cancellation, and progress notifications
- `yt-dlp` / `ffmpeg`
  - output format assumptions
  - merged-file behavior
  - metadata fields and download flags

These surfaces evolve faster than the rest of the repo. If a change depends on provider behavior, SDK semantics, preview features, or model-specific limits, verify it against upstream docs first.

## Modularity Rules

- Keep `src/index.ts` minimal. Do not move business logic into bootstrap code.
- Keep `src/server.ts` focused on MCP wiring, schemas, and request/task lifecycle glue.
- Keep provider-specific Gemini logic in `src/lib/gemini.ts`.
- Keep external-process and URL logic in `src/lib/youtube.ts`.
- Keep schemas, types, constants, logging, and error helpers separated from orchestration.
- If a flow grows enough that `src/lib/analysis.ts` becomes harder to scan, split by responsibility rather than adding another large section. Good candidates are `analysis-short`, `analysis-long`, and `analysis-follow-up`.
- Prefer pure helpers for planning, normalization, parsing, and validation so they are easy to unit test without network access.
- Do not edit `dist/` by hand. Change `src/` and rebuild.

## Testing Expectations

- Unit tests are required for behavior changes.
- Each MCP tool should have its own test coverage.
  - `analyze_youtube_video`
  - `analyze_long_youtube_video`
  - `continue_long_video_analysis`
- Keep existing helper-level tests, but add or extend tool-level tests when tool behavior changes.
- Prefer deterministic tests with fakes/stubs over real network calls.
- Treat `scripts/*.mjs` as manual smoke helpers only, because they may require real credentials, real downloads, or paid API usage.
- Run `npm run test` after meaningful changes. If a change affects build output or module boundaries, also ensure `npm run build` still passes.

## Change Guidelines

- Preserve structured stderr logging and machine-readable error payloads.
- Keep cancellation and timeout handling intact for long-running tasks.
- Validate model output against schema locally; do not trust provider output blindly.
- When adding a new tool or strategy, define its schema, orchestration path, error shape, and tests together.
- Prefer explicit names and small functions over clever abstractions.
- Avoid mixing unrelated concerns in one file just because they share the same tool flow.

## Safe Defaults For Agents

- Assume this is a server-first codebase: avoid browser-only solutions.
- Assume real Gemini and YouTube integrations are expensive or flaky in tests: mock them.
- When changing novel provider behavior, quote or link the exact upstream doc in your work notes or PR summary.
- When unsure whether behavior is contractually guaranteed by Gemini or MCP, treat it as unstable until docs confirm otherwise.
