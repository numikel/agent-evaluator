This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`agent-evaluator` is a local Node.js tool that evaluates chatbots and AI agents through their web UI.
A persona-driven "user simulator" agent (LangChain `createAgent` + Playwright) drives the conversation
and collects evidence (screenshots every step, downloads, transcript); a separate "judge" agent scores
the run against YAML rubrics and produces an HTML report with a percentage score and PASS/FAIL.

Version 0.1.0 is feature-complete for the first release. `docs/plans/README.md` holds the phase plan
that built it (requirements, hand-off notes, roadmap); `README.md` is the user-facing reference
(CLI, configuration tables, scoring, reports, limitations).

## Development commands

- `npm run verify` — lint + typecheck + build + unit/ui tests (build first: the CLI smoke test runs `dist/cli.js`)
- `npm run lint` / `npm run fix` — Biome
- `npm run typecheck` — `tsc` for `src/`, `fixtures/`, `e2e/`, `docs/screenshots/` and `ui/`
- `npm test` / `npm run test:watch` / `npm run test:coverage` — Vitest projects `unit` + `ui`
- `npm run test:e2e` — full pipeline against the demo chatbot on real Chromium (~20 s; needs `npx playwright install chromium` or `AE_CHROMIUM_PATH`)
- `npm run test:live` — opt-in smoke test with real models (`AE_LIVE_LLM=1`)
- `npm run build` — `dist/` (tsdown) + `dist/ui` (Vite)
- `npm run demo` (or `agent-evaluator demo` from the built CLI) — starts the demo chatbot fixture on port 3999
- `npx tsx docs/screenshots/capture.ts` — regenerates the README screenshots (after `npm run build`)

## Testing strategy

TDD, RED → GREEN → REFACTOR, one vertical slice at a time. Tests observe behaviour through public
seams (the `*/types.ts` contracts), never implementation details. LLM calls in tests use
`ScriptedChatModel` (`src/testing`), browser interaction uses `FakeBrowserSession`; the E2E suite
uses real Chromium with scripted models. Live-LLM tests are gated by `AE_LIVE_LLM=1` and never run
in CI.

## Architecture

Single package. `src/schemas` is the shared vocabulary (zod); `src/{browser,workspace,config,runner}/types.ts`
are frozen contracts (additive changes are recorded in `docs/decisions/`); `src/agents/{simulator,judge}`
are LangChain agents; `src/runner` orchestrates with LangGraph; `src/report` renders HTML/JSON/JUnit;
`src/server` is a Hono API + SSE; `src/cli` is the commander CLI; `ui/` is a Vite + React SPA;
`fixtures/demo-chatbot` is the test target; `e2e/` is the end-to-end suite. See `docs/architecture.md`
and `docs/decisions/`.

## Conventions

- English for all code, comments and documentation.
- Conventional Commits 1.0.0 (`feat(browser): …`, `fix(judge): …`, `chore: …`).
- Biome formatting (tabs, line width 100, double quotes). Strict TypeScript, ESM, `.js` import suffixes.
- Do not add dependencies without a reason stated in the commit body.
- Changelog entries go to `changelog.d/<topic>.md`, not `CHANGELOG.md`; the release assembles them.
- Never commit secrets; the API exposes provider *presence* only.
- Do not put model identifiers in code or documentation (commit trailers added by the tooling are fine).
- Releasing: see README "Development → Releasing" (`chore(release): x.y.z`, tag `vx.y.z`, `release.yml` publishes).
