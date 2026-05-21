# Troubleshooting

## `Missing GEMINI_API_KEY`

Set `GEMINI_API_KEY` in your MCP client config, shell environment, `.env` file for local development, or by running:

```bash
youtube-video-analyzer-mcp setup
```

## Metadata Fails

`get_youtube_video_metadata` requires `YOUTUBE_API_KEY`. Analysis tools do not require this key.

## Long Videos Fail

First call `get_youtube_analyzer_capabilities`.

If `ytDlpAvailable`, `ffmpegAvailable`, or `tempDirWritable` is false, use `strategy=url_chunks` or install the missing dependency.

## `yt-dlp` Is Not Found

Install `yt-dlp` and make sure it is on `PATH`, or set:

```bash
YT_DLP_PATH=/absolute/path/to/yt-dlp
```

On Windows, the path may point to `yt-dlp.exe`.

## `ffmpeg` Is Not Found

Install `ffmpeg` and make sure it is on `PATH`. Long-video `uploaded_file` handling needs it for media preparation.

## The Video Is Unavailable

Some YouTube videos cannot be analyzed:

- private videos;
- deleted videos;
- member-only videos;
- age-restricted videos;
- DRM-protected videos;
- region-blocked videos;
- videos blocked from embedding or external access.

Try a public video first to confirm your local setup works.

## The Request Times Out

Long videos should use `analyze_long_youtube_video`, which requires MCP task execution. Clients that only support synchronous tool calls with a fixed timeout, such as 120 seconds, should not call the task-only long-video tools for full VODs.

Use a task-capable client, use the compatibility job tools (`start_long_youtube_analysis`, `get_long_youtube_analysis_status`, `get_long_youtube_analysis_result`, and `cancel_long_youtube_analysis`), or analyze shorter bounded windows with `analyze_youtube_video` and `startOffsetSeconds` / `endOffsetSeconds`.

You can tune server-side values such as `MCP_TOOL_DEADLINE_MS`, `MCP_TASK_TTL_MS`, and Gemini stage timeouts. See [configuration.md](configuration.md).

## Gemini Quota Or Rate Limit Errors

Wait and retry, lower the requested scope, use a shorter clip window, or choose a less expensive model where appropriate.

## The Output Language Is Unexpected

The analysis tools try to detect and respond in the video's dominant language. Add an explicit language requirement to your prompt when you need a specific output language.

## JSON Output Is Not Valid Enough For Automation

Use a custom response schema when calling the analysis tool. Keep the schema small and explicit for better reliability.
