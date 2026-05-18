# Changelog

All notable changes to this project are documented here.

This project follows semantic versioning where practical.

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
