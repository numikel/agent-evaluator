# Phase 2 — BrowserSession (Playwright)

Depends on: P0. Wave 1 `[PARALLEL]`. Commit: `feat(browser): Playwright session with a11y refs, evidence capture and downloads`

## Goal
Implement `BrowserSession`/`BrowserSessionFactory` (`src/browser/types.ts`) on Playwright 1.64 so the
simulator can perceive the page through an accessibility tree with element refs, act, capture
screenshots, downloads, uploads, console/network logs, and detect when a streamed reply has finished.

## Read first
`src/browser/types.ts`, `src/testing/fake-browser-session.ts` (behavioural reference), `docs/architecture.md`
(perception model), `node_modules/playwright-core/types/types.d.ts` (search `ariaSnapshot`, `getByRef`, `waitForEvent('download')`, `filechooser`, `tracing`).
Borrowed ideas (agent-browser): annotated screenshots with numbered labels matching refs; skip-if-unchanged screenshots.

## Deliverables
- `src/browser/playwright-session.ts` — `PlaywrightSession implements BrowserSession`; `PlaywrightSessionFactory implements BrowserSessionFactory` (launches Chromium once per factory, one context + page per session, `acceptDownloads: true`, `storageState` when given, viewport, slowMo, default navigation timeout).
- `snapshot()` → `page.ariaSnapshot({ mode: "ai" })` (+ url/title). `click/type/press/scroll` via `page.getByRef(ref)`; `type` with `{ clear: true }` fills, `submit` presses Enter. Unknown ref → error `Unknown ref "e99" — take a new snapshot`.
- `screenshot()` → PNG bytes + size (viewport only, `scale: "css"`). Optional `annotate` helper (P6 vision mode): overlay numbered labels for interactive refs — implement if time allows, else leave a TODO in the brief for P6.
- `download(ref)` → `Promise.all([page.waitForEvent("download", { timeout }), click])`, `saveAs(downloadDir/<safe filename>)`, mime from `download.suggestedFilename()` extension map (+ sniff magic bytes for pdf/png/jpg/zip).
- `upload(ref, files)` → `page.waitForEvent("filechooser")` + `setFiles`.
- `waitForReplyStable({ timeoutMs, stableMs, onInterim, captureIntervalMs })` — poll `ariaSnapshot` every 250 ms; `firstChangeMs` = first diff vs the initial tree; `stable` when unchanged for `stableMs` **and** no in-flight requests (track via `page.on('request'/'requestfinished'/'requestfailed')` counters, ignore websockets/EventSource keep-alives by treating a request older than `stableMs` as idle); call `onInterim` with a screenshot every `captureIntervalMs`.
- `drainConsole`, `drainNetworkFailures` (responses ≥ 400 and `requestfailed`), `newImages` (img srcs added since last snapshot, absolute URLs), `currentUrl`, `close`.
- `src/browser/index.ts` exports; `src/browser/test-server.ts` (test helper: `node:http` server serving inline HTML fixtures on an ephemeral port).
- `changelog.d/phase-02-browser.md`.

## Seams & TDD slices
1. **RED first, guards the API:** open a page with `<button>Send</button><input aria-label="Message">`; `snapshot().tree` contains `[ref=e` and `textbox "Message"`; `click(refOfButton)` triggers an `onclick` that sets `document.title`. If this fails, stop and report — the plan's Playwright assumptions are wrong.
2. `type(ref, "hi", { submit: true })` dispatches Enter (page records keydown).
3. `download(ref)` on an `<a download href="data:application/pdf;base64,...">` saves a file with `bytes > 0` and `mime === "application/pdf"`; rejects with a clear message when nothing downloads within the timeout.
4. `upload(ref, [tmpFile])` on `<input type=file>` — page reports the file name.
5. `waitForReplyStable` on a page that appends text every 100 ms for 1 s: `firstChangeMs < 300`, `stable === true`, `elapsedMs ≥ 1000 + stableMs`, `onInterim` called ≥ 1 time; on a static page returns quickly with `firstChangeMs === undefined`.
6. Console error and failed fetch are drained once (second drain empty).
7. `close()` closes the context; factory `close()` closes the browser.
Tests run headless against the local test server; mark the file as `unit` project (it is in `src/**`). CI installs Chromium (`npx playwright install --with-deps chromium` is already in `ci.yml`). Keep total runtime < 30 s.

## Commands
`npx playwright install chromium` · `npm test -- src/browser` · `npm run verify`

## Definition of done
- [ ] Slices 1–7 green; no flaky waits (`page.waitForFunction`, not `sleep`).
- [ ] Downloads/uploads/console/network covered. Interim screenshots covered.
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
