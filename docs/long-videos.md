# Long Videos

Long videos and VODs need a different workflow because MCP clients and model providers can have outer request limits.

`analyze_long_youtube_video` and `continue_long_video_analysis` require MCP task execution. Clients that only support synchronous tool calls with fixed timeouts, such as 120 seconds, should use the compatibility job tools instead.

## Recommended Workflow

1. Call `get_youtube_analyzer_capabilities`.
2. Use the recommended strategy from the response.
3. Call `analyze_long_youtube_video` through your client's task workflow.
4. If the result includes `sessionId`, use `continue_long_video_analysis` through the task workflow for follow-up questions.

## Compatibility Job Workflow

Use this workflow when your MCP client does not support MCP tasks:

1. Call `get_youtube_analyzer_capabilities`.
2. Call `start_long_youtube_analysis`.
3. Poll `get_long_youtube_analysis_status` until the status is `done`, `error`, or `cancelled`.
4. Call `get_long_youtube_analysis_result`.
5. Optionally call `cancel_long_youtube_analysis` if the job should stop.

The start, status, result, and cancel calls are normal short MCP tool calls. The analysis continues in the server process between calls.

## Strategies

### `auto`

Recommended default. The server chooses the best available path.

When local support is available, `auto` prefers `uploaded_file`. If that fails or is unavailable, it can fall back to chunked URL analysis.

### `uploaded_file`

Best when `yt-dlp`, `ffmpeg`, and a writable temp directory are available.

This strategy downloads temporary media, uploads it to Gemini, and can create a reusable session. It is usually the best path for long VODs when the local environment supports it.

### `url_chunks`

Best when local download tools are unavailable.

This strategy avoids local media downloads and asks Gemini to analyze bounded windows from the YouTube URL. It can require more Gemini calls for long videos.

## Follow-Up Sessions

`analyze_long_youtube_video` may return a `sessionId`. Keep that ID if you want to ask follow-up questions through `continue_long_video_analysis`.

Follow-up sessions are useful for:

- drilling into specific sections;
- extracting timestamped lists;
- asking comparison questions;
- turning analysis into notes, outlines, or action items.

## Practical Limits

Long-video support depends on:

- Gemini quota and file processing behavior;
- whether YouTube allows access to the video;
- whether `yt-dlp` and `ffmpeg` are installed;
- MCP client support for tasks and long-running operations;
- local disk and temp directory permissions.
