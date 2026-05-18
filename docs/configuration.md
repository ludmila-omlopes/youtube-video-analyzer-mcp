# Configuration

Configuration can come from MCP client `env`, shell environment variables, a local `.env` file during development, or the config file created by `youtube-video-analyzer-mcp setup`.

## Common Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Google Gemini API key used by all analysis tools. |
| `YOUTUBE_API_KEY` | No | YouTube Data API v3 key used by `get_youtube_video_metadata`. |
| `GEMINI_MODEL` | No | Default model for short visual analysis. Defaults to `gemini-2.5-pro`. |
| `YT_DLP_PATH` | No | Command or path for `yt-dlp`. Defaults to `yt-dlp`. |
| `MCP_LOG_LEVEL` | No | `warn` by default. Use `info` for verbose logs or `silent` to suppress non-error logs. |
| `MCP_TOOL_DEADLINE_MS` | No | Outer per-tool deadline. Defaults to `110000`. |
| `MCP_TASK_TTL_MS` | No | Task TTL for long-running MCP tasks. Defaults to 30 minutes. |

## Timeout Variables

Advanced users can tune individual stages:

| Variable | Default |
| --- | --- |
| `YOUTUBE_METADATA_TIMEOUT_MS` | `60000` |
| `YOUTUBE_DOWNLOAD_TIMEOUT_MS` | `900000` |
| `GEMINI_FILE_UPLOAD_TIMEOUT_MS` | `900000` |
| `GEMINI_FILE_PROCESSING_DEADLINE_MS` | `1200000` |
| `GEMINI_FILE_PROCESSING_POLL_INTERVAL_MS` | `2000` |
| `GEMINI_TOKEN_COUNT_TIMEOUT_MS` | `60000` |
| `GEMINI_CACHE_CREATE_TIMEOUT_MS` | `60000` |
| `GEMINI_GENERATION_TIMEOUT_MS` | `600000` |
| `GEMINI_SYNTHESIS_TIMEOUT_MS` | `600000` |

## User Config File

Run:

```bash
youtube-video-analyzer-mcp setup
```

The server stores only these reusable runtime keys:

- `GEMINI_API_KEY`
- `YOUTUBE_API_KEY`
- `GEMINI_MODEL`
- `YT_DLP_PATH`

Environment variables provided by the MCP client take precedence over user config values.
