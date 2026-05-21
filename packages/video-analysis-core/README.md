# Video Analysis Core

Reusable TypeScript core for YouTube/video analysis workflows.

This package contains the transport-agnostic logic used by the YouTube Video Analyzer MCP server:

- YouTube URL normalization and metadata helpers.
- High-resolution YouTube frame extraction helpers.
- Gemini-backed video, audio, and long-video analysis.
- Long-video strategy planning for URL chunking and uploaded-file workflows.
- Chunk planning and synthesis helpers.
- Shared schemas, diagnostics, progress types, and session-store interfaces.

It intentionally does not register MCP tools, define SaaS routes, manage user auth, or own queue/database infrastructure. Host applications should provide those adapter layers.

## Install

```bash
npm install @ludylops/video-analysis-core
```

## Basic Usage

```ts
import { createVideoAnalysisService } from "@ludylops/video-analysis-core";

const service = createVideoAnalysisService();

const result = await service.analyzeShort({
  youtubeUrl: "https://www.youtube.com/watch?v=...",
  analysisPrompt: "Summarize with timestamps.",
});
```

Set `GEMINI_API_KEY` in the environment before using the default Gemini client.

## Development

```bash
npm run test --workspace @ludylops/video-analysis-core
npm run build --workspace @ludylops/video-analysis-core
```

The core test suite avoids network and provider calls by focusing on deterministic planning, parsing, and normalization behavior.

## Long Videos

Use the core runtime helpers to inspect local support for long-video strategies:

```ts
import { getLongVideoRuntimeCapabilities } from "@ludylops/video-analysis-core/youtube/runtime";

const capabilities = await getLongVideoRuntimeCapabilities("uploaded_file");
```

Applications can then choose whether to run uploaded-file analysis, URL chunking, a remote worker, or their own queue/job wrapper.
