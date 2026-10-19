### Added

- **Runs page** (`/runs`): table of every run (scenario, persona, target, status badge, score
  ring, turns, start time, duration) with scenario and status filters kept in the query string,
  and a "Run scenario" dialog (scenario, target override, repeat, headed browser) that posts to
  `POST /api/runs` and opens the first run. `/runs?launch=1` opens the dialog directly.
- **Live run view** (`/runs/:id`): status, turn k/N and an elapsed timer; an evidence strip of
  step screenshots that grows as `step` events arrive (click one for the full image, the action
  JSON and the accessibility snapshot); transcript with bot reply latency; downloads with links
  to the artifacts; criteria filling in as the judge scores them; a cancel button; and, once the
  run is done, the score gauge, summary and the standalone report embedded from
  `/api/runs/:id/report` with an "open in new tab" link. Fatal errors are explained in place, a
  "Reconnecting…" indicator shows while the browser re-establishes the SSE stream (the server
  replays history, so reloads are safe), and finished runs render from the stored record plus
  the persisted `events.jsonl` without opening a stream.
- **Dashboard** (`/`): the last ten runs, pass rate per scenario derived client-side from
  `GET /api/runs`, and quick links to launch a run and browse.
- Pure `applyRunEvent` reducer (`ui/src/runs/reducer.ts`) keyed so SSE replays are idempotent;
  event bursts are folded in one `startTransition` per microtask.
- Route-level code splitting: the editors and run pages load on demand (main chunk ~330 kB,
  down from ~570 kB).
