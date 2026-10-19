# Phase 3 — Demo chatbot fixture

Depends on: P0. Wave 1 `[PARALLEL]`. Commit: `feat(fixtures): scripted demo chatbot for end-to-end tests`

## Goal
A small, deterministic chatbot web app used by the E2E tests (P13), the README quick start and manual
testing. It must exercise everything the simulator and judge care about: streaming replies, a PDF
download, file upload, and configurable failure modes.

## Read first
`templates/target.yaml` (hints describe this UI), `templates/scenario.yaml` (the invoice flow it must support), `docs/architecture.md`.

## Deliverables
- `fixtures/demo-chatbot/server.ts` — Hono app via `@hono/node-server`, port `3999` (env `DEMO_PORT`), `npm run demo` already wired.
  Routes: `GET /` (chat page), `POST /api/chat` (SSE token stream of the reply), `GET /api/invoice/:month.pdf` (generates a minimal valid PDF, ≥ 500 bytes, containing the text "Invoice September 2026"), `POST /api/upload` (multipart, replies with the file name), `GET /api/reset`.
- `fixtures/demo-chatbot/public/index.html` + `app.js` + `style.css` — vanilla JS; message list (`role="log"`), textarea `aria-label="Message"`, button "Send", Enter submits; bot messages render Markdown-lite (links + a **Download** button when the reply carries an attachment); `data-testid`s on input/send/messages; `<input type=file aria-label="Attach file">`.
- `fixtures/demo-chatbot/brain.ts` — pure function `reply(history, mode)`: greeting; asks for customer number if missing; "invoice" + month → confirms and attaches `/api/invoice/<month>.pdf`; unknown → polite fallback. Modes via `?mode=`: `normal` (default), `slow` (3 s delay, streams), `offtopic` (pushes a newsletter before answering), `broken` (never finishes streaming; console.error), `noattach` (describes the invoice but never attaches a file).
- Tests `fixtures/demo-chatbot/brain.test.ts` (pure logic for each mode) and `fixtures/demo-chatbot/server.test.ts` (`app.request()` for `/api/invoice/september.pdf` → `application/pdf`, bytes ≥ 500; `/api/chat` streams).
- `changelog.d/phase-03-demo-chatbot.md`.

## Seams & TDD slices
1. `reply([], "normal")` greets and asks what the user needs.
2. `reply([user: "need my invoice for september"], "normal")` asks for the customer number; with number present → attaches the PDF URL and confirms the month.
3. `offtopic` prepends an unrelated promo; `noattach` never includes an attachment; `broken` marks `streamForever: true`.
4. Server returns a PDF with the right content type and size; upload echoes the file name.
Keep the UI dependency-free (no framework), accessible (labels, roles) so a11y snapshots are meaningful.

## Commands
`npm run demo` (manual) · `npm test -- fixtures` · `npm run verify`

## Definition of done
- [ ] All modes implemented and tested; UI usable by a human in the browser.
- [ ] No new dependencies (a hand-rolled minimal PDF writer is fine). Changelog fragment. `npm run verify` green.
