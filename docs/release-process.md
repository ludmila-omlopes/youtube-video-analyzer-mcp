# Release Process

Use this checklist for public releases.

## Before Release

1. Confirm `package.json` version.
2. Confirm `server.json` version and package version.
3. Confirm `SERVER_INFO.version` in `src/core/lib/constants.ts`.
4. Update `CHANGELOG.md`.
5. Run:

```bash
npm run build
npm test
```

## Publish

```bash
npm publish
```

## After Publish

1. Create a GitHub release using the changelog entry.
2. Refresh MCP Registry metadata if needed.
3. Test the package through `npx` from a clean environment.
4. Check the README and package page on npm.

## Versioning Guidance

Use semantic versioning:

- Patch: bug fixes, docs fixes, small compatibility improvements.
- Minor: new tools, new options, new supported workflows.
- Major: breaking changes to tool names, required inputs, output shapes, or runtime requirements.
