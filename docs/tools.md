# Tools

This server exposes eleven MCP tools.

## `get_youtube_analyzer_capabilities`

Checks the local runtime before long-video analysis.

Use it when:

- You want to analyze a long video or VOD.
- You need to know whether `yt-dlp`, `ffmpeg`, and temp storage are available.
- You want the server to recommend `uploaded_file` or `url_chunks`.

## `get_youtube_video_metadata`

Fetches normalized public YouTube metadata with the YouTube Data API.

Use it when:

- You need title, channel, duration, publish date, or other metadata.
- You want metadata without sending the video to Gemini.

Requires `YOUTUBE_API_KEY`.

## `get_youtube_video_frame`

Extracts a high-resolution JPEG frame from a public YouTube video at a timestamp.

Use it when:

- You need a visual reference, thumbnail candidate, or exact frame for downstream work.
- You want the original available video resolution instead of the low-resolution media used for Gemini token budgeting.
- `yt-dlp`, `ffmpeg`, and writable temp storage are available.

Returns base64 JPEG data in structured content and an MCP `image/jpeg` content item. The tool only returns exact extracted frames; it does not use Gemini image generation as a fallback.

Optional timestamp refinement:

- Pass `timestampRefinementPrompt` when `timestampSeconds` is approximate and you can describe the desired frame.
- Gemini will inspect only a bounded window around `timestampSeconds` and return JSON with a refined timestamp.
- The JPEG still comes only from local `yt-dlp` and `ffmpeg` extraction.

## `analyze_youtube_video`

Analyzes a public YouTube video with Gemini.

Use it when:

- The video is short enough for a normal tool call.
- You want visual and audio understanding.
- You want to analyze a bounded clip with `startOffsetSeconds` and `endOffsetSeconds`.
- You want structured JSON by passing a custom response schema.

## `analyze_youtube_video_audio`

Analyzes a public YouTube video with audio-first instructions.

Use it when:

- Spoken content matters more than visuals.
- You want transcript-like understanding, claims, arguments, action items, or quotes.
- You want the model to avoid relying on visual-only evidence.

## `analyze_long_youtube_video`

Analyzes long public YouTube videos and VODs as a required MCP task.

Use it when:

- A video is too long for a normal short-video tool call.
- Your MCP client supports tasks or long-running tool workflows.
- You want a reusable `sessionId` for follow-up questions.

Call `get_youtube_analyzer_capabilities` first.

Do not call this tool from a client that only supports synchronous tool calls with a fixed timeout such as 120 seconds. Use a task-capable client, or analyze shorter bounded windows with `analyze_youtube_video`.

## `start_long_youtube_analysis`

Starts long public YouTube video or VOD analysis as a server-managed background job and returns immediately.

Use it when:

- Your MCP client does not support MCP tasks.
- Your MCP client has a fixed synchronous timeout such as 120 seconds.
- You can poll for status and result with separate tool calls.

Call `get_youtube_analyzer_capabilities` first, then call this tool with the same input shape as `analyze_long_youtube_video`.

## `get_long_youtube_analysis_status`

Returns the status and latest progress for a job created by `start_long_youtube_analysis`.

Statuses are `queued`, `running`, `done`, `error`, and `cancelled`.

## `get_long_youtube_analysis_result`

Returns the final result for a job created by `start_long_youtube_analysis`.

While the job is still `queued` or `running`, `result` and `error` are null. When the job is `done`, `result` contains the long-video analysis output. When the job is `error`, `error` contains structured diagnostic information.

## `cancel_long_youtube_analysis`

Cancels a queued or running job created by `start_long_youtube_analysis`.

## `continue_long_video_analysis`

Asks follow-up questions against a previous long-video session as a required MCP task.

Use it only after `analyze_long_youtube_video` returns a non-null `sessionId`.

Example follow-ups:

- "List every product mentioned with timestamps."
- "Extract the speaker's recommendations as a checklist."
- "Find contradictions in the previous analysis."
- "Summarize only the Q&A section."
