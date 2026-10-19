# Phase 13 — End-to-end tests and CI hardening

Depends on: P3 P10 P11 (Wave 3 `[PARALLEL]`). Commit: `test(e2e): full pipeline against the demo chatbot with scripted models`

## Goal
Prove the whole pipeline on a real Chromium against the demo chatbot, deterministically (scripted models),
plus an opt-in live-LLM smoke test; make CI run it.

## Read first
`vitest.config.ts` (project `e2e`, `e2e/**`), `fixtures/demo-chatbot`, `src/testing/*`, `src/index.ts`, `.github/workflows/ci.yml`.

## Deliverables
- `e2e/helpers.ts` — start demo chatbot in-process on a free port, temp workspace from templates with `target.url` rewritten, `ScriptedChatModel` factory implementing `ModelFactory` (simulator script: snapshot → send_message("need my invoice for september, customer 4471") → download(ref of the Download button, found by scanning the latest snapshot in a scripted function) → end_conversation; judge script: structured outputs for each criterion).
- `e2e/pipeline.test.ts` — happy path: run via `createRunner` → PASSED, `verdict.json` has `pdf_delivered` pass with bytes ≥ 500, `report.html` contains `%`, screenshots exist for every step, interim screenshots exist for the streamed reply, transcript has 1 user + 1 bot entry.
- `e2e/failure-modes.test.ts` — `?mode=noattach` → `pdf_delivered` fails → FAILED with breakdown; `?mode=broken` → `waitForReplyStable` times out, `no_console_errors` fails, run still judged; `max_turns: 1` with a chatty script → FAILED `max_turns`.
- `e2e/cli.test.ts` — `node dist/cli.js run invoice-export-september --json` against the temp workspace with `AE_MODEL_FACTORY=scripted` hook (add a tiny env-gated injection point in the CLI deps builder) → exit code and JSON.
- `e2e/live.test.ts` — skipped unless `AE_LIVE_LLM=1`: real models from env, asserts only that a verdict is produced and the report renders.
- CI: add `npm run test:e2e` step after unit tests (Chromium already installed); upload `runs/**/report.html` as an artifact on failure (`actions/upload-artifact@v4`).
- `changelog.d/phase-13-e2e.md`.

## Definition of done
- [ ] E2E suite < 90 s locally; green on CI for Node 24 and 26.
- [ ] Flake policy: no `sleep`; waits are condition-based.
- [ ] No new dependencies. Changelog fragment. `npm run verify && npm run test:e2e` green.
