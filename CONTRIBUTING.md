# Contributing

Thank you for your interest in contributing!

## Development setup

Requirements: Node.js 24 or later (the action runs on `node24`).

```bash
npm ci          # install dependencies
npm test        # run unit tests (Jest)
npx tsc --noEmit -p .   # typecheck
npm run build   # bundle to dist/index.js with @vercel/ncc
```

## The dist/ bundle must be committed

GitHub Actions executes the committed `dist/index.js` directly — it is the build artifact
of this repository. **Any change to `src/` must be accompanied by a rebuilt bundle:**

```bash
npm run build
git add dist/
```

CI rebuilds the bundle and fails the check if `dist/` does not match the committed state.
The same applies to Dependabot PRs that bump runtime dependencies: check out the PR branch,
run `npm run build`, and push the updated `dist/` before merging.

## Tests

Unit tests live alongside the source as `src/*.test.ts` and use Jest with mocked `axios`
and `@actions/core` — no network access and no real credentials. New functionality should
come with tests; `npm test` must pass before a PR can merge.

## Pull requests

- Keep changes focused; one logical change per PR.
- Update `README.md` and `action.yml` input/output descriptions when behavior changes.
- Do not add runtime dependencies without discussion — the action deliberately keeps a
  minimal dependency surface (`@actions/core`, `axios`).
- Note: `@actions/core` must stay on 2.x (3.x is ESM-only; this project compiles to CommonJS).

## Reporting issues

Use GitHub issues for bugs and feature requests. For security vulnerabilities, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.
