# Changelog

All notable changes to this project are documented here.

This project follows semantic versioning where practical.

## Unreleased

### Added

- `get_youtube_video_frame`, a new MCP tool for extracting a high-resolution JPEG frame from a YouTube video timestamp.
- Reusable core frame extraction support using `yt-dlp` and `ffmpeg`.
- Optional Gemini timestamp refinement for frame extraction; Gemini returns JSON timestamps only, while the frame bytes still come from `yt-dlp` and `ffmpeg`.

## 0.3.0 - 2026-05-18

### Added

- Long-video and VOD analysis through MCP tasks.
- Follow-up questions for reusable long-video sessions.
- Capability inspection for long-video strategy selection.
- Audio-focused analysis tool for speech-heavy videos.
- CLI setup flow for reusable local configuration.

### Changed

- Expanded README with install, MCP client config, tool, long-video, and publishing guidance.
- Improved runtime guidance for `yt-dlp`, `ffmpeg`, and long-video strategies.
- Long-video tools now require MCP task execution so synchronous clients with fixed timeouts fail fast instead of timing out mid-analysis.
- Added compatibility background job tools for long-video analysis clients that do not support MCP tasks.
- Started the npm workspace monorepo split with reusable `@ludylops/video-analysis-core` package consumed by the MCP server.

### Notes

- `GEMINI_API_KEY` is required for analysis.
- `YOUTUBE_API_KEY` is optional and only required for metadata lookup.
- Best long-video support requires `yt-dlp`, `ffmpeg`, and a writable temp directory.

## 0.2.0 - Previous Release

### Added

- Core MCP stdio server for YouTube analysis with Gemini.
- Short-video analysis.
- YouTube metadata lookup.
- Local test suite.
