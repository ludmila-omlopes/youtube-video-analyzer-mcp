# Examples

These examples are prompts you can use from an MCP-compatible client after configuring the server.

## Short Video Summary

```text
Analyze this YouTube video and summarize the main argument in the video's original language:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Timestamped Study Notes

```text
Analyze this lecture and return timestamped study notes, key terms, and a final review checklist:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Audio-First Analysis

```text
Use the audio analysis tool for this video. Extract the speaker's claims, supporting evidence, and action items:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Clip Window

```text
Analyze only the section from 120 seconds to 420 seconds. Return the important points with timestamps:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Metadata Lookup

```text
Fetch metadata for this YouTube video before analyzing it:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Long VOD Workflow

```text
Check the YouTube analyzer capabilities, then analyze this long VOD. Focus on decisions, tasks, names, dates, and timestamps:
https://www.youtube.com/watch?v=VIDEO_ID
```

## Follow-Up Question

```text
Continue the previous long-video analysis and list every concrete recommendation with a timestamp and confidence level.
```

## Structured Output

Ask your MCP client to call `analyze_youtube_video` with a custom JSON schema when you need predictable output for downstream processing.

Example target shape:

```json
{
  "summary": "string",
  "language": "string",
  "topics": ["string"],
  "timestampedMoments": [
    {
      "time": "string",
      "event": "string",
      "importance": "low | medium | high"
    }
  ]
}
```
