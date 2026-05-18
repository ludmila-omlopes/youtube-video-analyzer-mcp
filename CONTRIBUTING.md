# Contributing

Thanks for helping improve YouTube Video Analyzer MCP.

## Development

```bash
npm install
npm run build
npm test
```

Copy `.env.example` to `.env` for local manual testing. Do not commit real API keys.

## Pull Requests

Before opening a pull request:

1. Keep changes focused.
2. Add or update tests for behavior changes.
3. Update documentation for user-visible changes.
4. Update `CHANGELOG.md` when users should know about the change.
5. Run `npm run build` and `npm test`.

## Documentation Style

Write for people installing this from many different environments. Prefer direct examples, clear requirements, and plain explanations of failure modes.

## Release Notes

Use `CHANGELOG.md` for user-facing release notes. Group entries under:

- `Added`
- `Changed`
- `Fixed`
- `Removed`
- `Security`
