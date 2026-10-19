# Phase 12b — UI: run launcher, live view, reports

Depends on: P10 P12a (Wave 3 `[PARALLEL]`). Commit: `feat(ui): run launcher, live evidence view and report pages`

## Goal
Start runs from the UI, watch them live (screenshots + transcript + criteria as they arrive), browse past runs and open reports.

## Read first
`src/schemas/run.ts` (RunEvent), `ui/src/api/sse.ts`, `src/report` (the standalone report is embedded, not re-implemented), *react-best-practices* (`startTransition` for event bursts, derive state in render).

## Deliverables
- `/runs`: table (scenario, persona, target, status badge, score %, turns, started, duration) with filters by scenario/status; "Run scenario" dialog (scenario select, target override, repeat, headed) → `POST /api/runs` → navigate to the first run.
- `/runs/:id` live view: header (status, turn k/N, elapsed), **evidence strip** of step thumbnails updating from `step` events (click → full image + action + snapshot text), transcript panel (`message` events, latency per bot reply), downloads panel, criteria panel filling from `criterion` events, cancel button; on `done` shows score gauge + summary and a link/iframe to `/api/runs/:id/report`; `error` state explained.
- Dashboard `/`: last 10 runs, pass rate per scenario (derived client-side), quick links.
- Reconnect logic: SSE replays history, so reload is safe; show a "reconnecting" indicator.
- Tests: reducer `applyRunEvent(state, event)` (pure) for every event type; live page renders thumbnails after `step` events from a mocked `EventSource`; launcher posts the right body; dashboard pass-rate math.
- `changelog.d/phase-12b-ui-runs.md`.

## Definition of done
- [ ] Live view verified against a real run of the demo chatbot (`npm run demo` + `npm run dev`), noted in the commit body.
- [ ] Event bursts (100 steps) don't freeze the UI (batch with `startTransition`).
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
