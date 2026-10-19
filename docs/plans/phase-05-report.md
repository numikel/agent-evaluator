# Phase 5 — Report renderer

Depends on: P0. Wave 1 `[PARALLEL]`. Commit: `feat(report): self-contained HTML report, summary JSON and JUnit output`

## Goal
Pure functions that turn run artifacts into `report.html` (single file, no external assets), `summary.json`
and `junit.xml`, so a developer can open the report from `runs/<id>/` or attach it in CI.

## Read first
`src/schemas/run.ts` (RunRecord, Step, TranscriptEntry, DownloadArtifact, ConsoleEntry, Verdict), `docs/architecture.md`
(evidence layout), `docs/plans/README.md` → reference skills *frontend-design* (token system, restraint) and
*web-design-guidelines*. Inspiration: Playwright HTML report (filmstrip, before/after), Midscene replay report.

## Deliverables
- `src/report/types.ts` — `ReportInput = { run, verdict, steps, transcript, downloads, console, resolved: { scenario, persona: frontmatter, target, rubric, evaluator } }`.
- `src/report/html.ts` — `renderHtml(input, { inlineImages?: boolean, imageLoader? })`: header (scenario, persona, target, models, status badge, **score as percentage** with a gauge, pass threshold, turns `used/max`); criteria table (id, type, weight, required, score %, pass, reason, evidence links → screenshot anchors); transcript with per-turn screenshots (thumbnails link to full image; relative paths by default, base64 when `inlineImages`); filmstrip of all steps with action labels + interim captures; downloads list (name, mime, bytes, extracted excerpt); console errors; judge summary + goal assessment; collapsible raw JSON. Inline CSS only, system font stack, light/dark via `prefers-color-scheme`, no JS frameworks (small vanilla script for toggles is fine). Escape all user/model text.
- `src/report/summary.ts` — `renderSummary(input)` → `{ runId, scenario, status, score, percent, pass_threshold, goal_reached, turns_used, max_turns, criteria: [{id, score, pass, required}], started_at, finished_at }`.
- `src/report/junit.ts` — `renderJUnit(input)` → one `<testcase>` per criterion inside a `<testsuite name="scenario">`; failed criteria have `<failure message=reason>`; run FAILED/ERROR → suite-level failure count.
- `src/report/fixtures/` — one golden `ReportInput` JSON (PASSED) and one (FAILED on max_turns) used by tests; `src/report/index.ts`; `changelog.d/phase-05-report.md`.

## Seams & TDD slices
1. `renderSummary` percent = `round(score*100)`; FAILED fixture keeps the criteria breakdown.
2. `renderJUnit` is well-formed XML (parse with a tiny regex-free check: use `DOMParser` from jsdom in test) with N testcases and correct failure count.
3. `renderHtml` contains the percentage, the status badge text, every criterion id, every transcript message (escaped — a message containing `<script>` must appear escaped), screenshot `<img src="steps/003/after.png">` relative paths; with `inlineImages` uses `data:image/png;base64,` via the injected loader.
4. Snapshot test of the HTML for the PASSED fixture (`toMatchFileSnapshot`) to catch accidental layout regressions.
5. Interim screenshots render inside the filmstrip for the step they belong to.

## Commands
`npm test -- src/report` · `npm run verify`

## Definition of done
- [ ] Report opens offline in a browser from `runs/<id>/report.html` (manual check with the fixture written to a temp dir).
- [ ] Accessible: headings hierarchy, table headers, alt text on screenshots, focus-visible styles.
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
