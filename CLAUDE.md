This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`agent-evaluator` is a local Node.js tool that evaluates chatbots and AI agents through their web UI.
A persona-driven "user simulator" agent (LangChain `createAgent` + Playwright) drives the conversation
and collects evidence (screenshots every step, downloads, transcript); a separate "judge" agent scores
the run against YAML rubrics and produces an HTML report with a percentage score and PASS/FAIL.

Read `docs/plans/README.md` first: it holds the phase plan, the dependency graph and the rules for
working in parallel. Each phase has a self-contained brief in `docs/plans/phase-NN-*.md`.

## Development commands

- `npm run verify` — lint + typecheck + unit/ui tests + build (the definition of done)
- `npm run lint` / `npm run fix` — Biome
- `npm run typecheck` — `tsc` for `src/` and `ui/`
- `npm test` / `npm run test:watch` / `npm run test:coverage` — Vitest projects `unit` + `ui`
- `npm run test:e2e` — full pipeline against the demo chatbot (needs `npx playwright install chromium`)
- `npm run build` — `dist/` (tsdown) + `dist/ui` (Vite)
- `npm run demo` — starts the demo chatbot fixture on port 3999

## Testing strategy

TDD, RED → GREEN → REFACTOR, one vertical slice at a time. Tests observe behaviour through public
seams (the `*/types.ts` contracts), never implementation details. LLM calls in tests use
`ScriptedChatModel` (`src/testing`), browser interaction uses `FakeBrowserSession`. Live-LLM tests
are gated by `AE_LIVE_LLM=1` and never run in CI.

## Architecture

Single package. `src/schemas` is the shared vocabulary (zod); `src/{browser,workspace,config,runner}/types.ts`
are frozen contracts; `src/agents/{simulator,judge}` are LangChain agents; `src/runner` orchestrates
with LangGraph; `src/server` is a Hono API + SSE; `ui/` is a Vite + React SPA; `fixtures/demo-chatbot`
is the test target. See `docs/architecture.md` and `docs/decisions/`.

## Conventions

- English for all code, comments and documentation.
- Conventional Commits 1.0.0 (`feat(browser): …`, `fix(judge): …`, `chore: …`). One commit per phase.
- Biome formatting (tabs, line width 100, double quotes). Strict TypeScript, ESM, `.js` import suffixes.
- Do not add dependencies unless the phase brief says so (P0 installed everything needed).
- Changelog entries go to `changelog.d/<phase>.md`, not `CHANGELOG.md`.
- Never commit secrets; the API exposes provider *presence* only.
- Do not put model identifiers in code or documentation (commit trailers added by the tooling are fine).
