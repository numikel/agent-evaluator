# Contributing

Thanks for helping improve agent-evaluator. This page covers the mechanics; the design and the
module contracts are described in [`docs/architecture.md`](./docs/architecture.md) and
[`docs/decisions/`](./docs/decisions/).

## Setup

```bash
git clone https://github.com/numikel/agent-evaluator.git
cd agent-evaluator
npm ci
npx playwright install chromium
npm run verify
```

If Chromium is installed elsewhere, point the tool at it with `AE_CHROMIUM_PATH=/path/to/chrome`.

## Workflow

1. Create a branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Work test-first: write the failing test through the public seam (`src/*/types.ts`, the CLI, the
   HTTP API or the UI), make it pass, then refactor. LLM calls in tests use `ScriptedChatModel`
   and browser interaction uses `FakeBrowserSession` (both in `src/testing/`). Live-model tests
   are gated by `AE_LIVE_LLM=1` and never run in CI.
3. Run `npm run verify`; run `npm run test:e2e` when you touched the browser, simulator, runner,
   judge or the demo chatbot.
4. Add a changelog fragment under `changelog.d/<topic>.md` (Keep-a-Changelog bullets). Do not edit
   `CHANGELOG.md` directly; it is assembled at release time.
5. Open a pull request against `main` and fill in the template.

## Conventions

- Conventional Commits 1.0.0: `feat(judge): add latency criterion`, `fix(browser): ...`, `docs: ...`.
- Biome formatting (`npm run fix`), strict TypeScript, ESM with `.js` import suffixes.
- English for code, comments and documentation.
- Do not add dependencies without saying why in the pull request.
- Never commit secrets. Configuration files hold `provider:model` references only; keys come from
  the environment. Screenshots and fixtures must not contain real customer data.

## Releasing

Releases are published by the `release.yml` workflow, started either by pushing a `vX.Y.Z` tag on
`main` or manually from Actions → Release → Run workflow (the job then creates the tag). Before
that: bump `version` in `package.json`, move the `changelog.d/` fragments into a new `CHANGELOG.md`
section and run `npm pack --dry-run`. The workflow uses the `NPM_TOKEN` secret; with a 2FA-bypass
token npm stages the publish and a maintainer approves it on npmjs.com. See the README section
"Development → Releasing" for the full procedure and the Trusted Publishing alternative.
