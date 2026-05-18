# Tools

This server exposes six MCP tools.

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

Analyzes long public YouTube videos and VODs as an MCP task.

Use it when:

- A video is too long for a normal short-video tool call.
- Your MCP client supports tasks or long-running tool workflows.
- You want a reusable `sessionId` for follow-up questions.

Call `get_youtube_analyzer_capabilities` first.

## `continue_long_video_analysis`

Asks follow-up questions against a previous long-video session.

Use it only after `analyze_long_youtube_video` returns a non-null `sessionId`.

Example follow-ups:

- "List every product mentioned with timestamps."
- "Extract the speaker's recommendations as a checklist."
- "Find contradictions in the previous analysis."
- "Summarize only the Q&A section."
