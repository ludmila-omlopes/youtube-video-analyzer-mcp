# Security

Please do not report security issues in public issue threads.

This MCP server uses API keys and may process YouTube URLs, prompts, temporary media files, and model outputs. Treat all credentials and private analysis content as sensitive.

## Sensitive Data

- Do not commit `.env` files with real credentials.
- Do not share Gemini or YouTube API keys in logs.
- Do not publish private video content or confidential prompts in public issues.

## Runtime Behavior

Depending on the selected strategy, this server may send YouTube URLs, prompts, media inputs, uploaded files, or derived chunks to Google Gemini. With `uploaded_file`, temporary local media may be created before upload.

Users are responsible for reviewing provider terms, YouTube terms, copyright obligations, and local laws before processing content.
