# Architecture

Status: written in Phase 0; the run-lifecycle section reflects the Phase 10 runner.

## Overview

```
                 workspace files (personas/, scenarios/, rubrics/, targets/, evaluator.yaml, agent-evaluator.yaml)
                                              │
                                              ▼
 CLI / UI ──► Hono server ──► Runner (LangGraph graph per run)
                                   │
                 ┌─────────────────┼──────────────────────┐
                 ▼                 ▼                      ▼
        Simulator agent     RunStore (runs/<id>/…)    Judge agent
   (createAgent + tools)    screenshots, snapshots,  (deterministic + LLM
            │               transcript, downloads     criteria, evidence)
            ▼                                              │
     BrowserSession                                        ▼
   (Playwright, a11y refs)                           Verdict → Report (HTML/JSON/JUnit)
```

## Modules and contracts

| Module | Contract | Implementation phase |
| --- | --- | --- |
| `src/schemas` | zod schemas + `computeOutcome` | P0 |
| `src/browser` | `BrowserSession`, `BrowserSessionFactory` | P2 |
| `src/workspace` | `Workspace`, `RunStore` | P1 |
| `src/config` | `SecretsProvider`, `ProviderRegistry`, `ModelFactory` | P4 |
| `src/agents/simulator` | `runSimulator({ resolved, session, model, recorder, … })` → turn loop | P6 |
| `src/agents/judge` | `judgeRun(input, deps)` → `Verdict` | P7 |
| `src/runner` | `Runner`, `RunEvent`; `createRunner(deps)` → `RunnerHandle` (+ `wait`, `close`) | P10 |
| `src/report` | `renderReport(input, options?)` → `report.html`, `summary.json`, `junit.xml` | P5 |
| `src/server` | Hono app factory | P8 |
| `src/cli` | commander program | P11 |

Contracts in `*/types.ts` are frozen after P0 (see `docs/plans/README.md`, rule 6).

## Run lifecycle

Implemented in P10 by `createRunner` (`src/runner`). `start(request)` resolves the scenario (persona,
target, rubric with built-in criteria, evaluator, settings) and builds the simulator / judge models —
any failure there is a `RunPreconditionError` and nothing is written. It then expands
`scenario.repeat × request.repeat` into run records (`PENDING`, ids `YYYYMMDD-HHMMSS-<scenario>-<4 hex>`),
queues them behind a `settings.concurrency` semaphore and returns the ids immediately.

Each run is one LangGraph `StateGraph` (`src/runner/graph.ts`) streamed with
`streamMode: ["updates", "custom"]`; nodes push `RunEvent`s through the custom writer and the runner
appends every event to `events.jsonl` **before** fanning it out to `subscribe` listeners, so SSE late
joiners replay exactly what live clients saw. Nodes never throw: a failure lands in `state.error`,
the graph routes to `collect` (which always closes the browser) and ends.

1. **setup** — `run.json` → `RUNNING` (`run_started`, `status` events); write `scenario.snapshot.yaml`;
   create the browser session (`headless` = request override, else `settings.browser.headless && target.headless`;
   `auth.storage_state` resolved against the workspace root); `open(target.url)`; when
   `auth.login_steps` is set, run a short simulator pass whose steps are recorded as turn 0.
2. **converse** — `runSimulator` with the `RunStore`-backed `StepRecorder`: every tool call becomes
   `steps/NNN/` (before/after/interim PNGs, snapshot, action.json) and a `step` event; user transcript
   entries emit `turn` + `message`, bot entries `message`; downloads are moved into `downloads/` and
   emit `download`. `turns_used` and `simulator_outcome` are written to `run.json`. Reasons
   `goal_reached`, `gave_up`, `blocked` and `max_turns` continue to judging (the verdict decides the
   status); `error` ends the run as `ERROR`.
3. **collect** — drain console (`console.jsonl`) and network failures (`log` events), close the
   session, remove the temporary download directory.
4. **judge** — `run.json` → `JUDGING`; extract downloaded files once and persist their `text_excerpt`
   into `downloads.json`; `judge_started` with the criterion ids; `judgeRun` emits one `criterion`
   event per scored criterion (deterministic first); `verdict.json` is saved. Judge-model errors end
   the run as `ERROR`.
5. **report** — `run.json` → `PASSED | FAILED` with `score` and `finished_at`; render `report.html`
   (screenshots inlined as `data:` URIs), `summary.json`, `junit.xml`; emit `status` then `done`.

Terminal statuses: `PASSED`, `FAILED`, `ERROR`. `cancel(runId)` aborts the run's `AbortSignal`
(the simulator agent and the graph stop, the browser is closed) and records `ERROR` with
`error: "cancelled"`; a queued run that is cancelled never opens a browser. Every `ERROR` ends with a
`status: ERROR` event followed by a fatal `error` event. `runner.close()` cancels in-flight runs,
waits for them and closes the browser factory.

## Evidence layout

```
runs/<runId>/
  run.json                  RunRecord (status updated in place)
  scenario.snapshot.yaml    resolved scenario + persona + rubric at run time
  events.jsonl              every RunEvent
  transcript.jsonl          TranscriptEntry per line
  console.jsonl             ConsoleEntry per line
  steps/NNN/before.png | after.png | interim-K.png | snapshot.txt | action.json
  downloads/<file>          saved attachments (+ downloads.json index)
  verdict.json
  report.html | summary.json | junit.xml
```

## Perception model

Default: `page.ariaSnapshot({ mode: "ai" })` yields a YAML accessibility tree with `[ref=eN]` markers;
tools act through `page.getByRef("eN")`. This is provider-agnostic (no vision model required) and cheap.
Vision mode (per target/scenario) adds `screenshot_view`, `click_at`, `type_at`; screenshots are injected as
`{ type: "image", data, mimeType: "image/png" }` content blocks in a trailing `HumanMessage` by a
`wrapModelCall` middleware — never inside `ToolMessage`s, which several providers reject.

## Judge inputs (D8)

`evaluator.principles` + scenario (`goal`, `intent`, `context`, `success_criteria`, `max_turns`, `turns_used`)
+ persona summary + target hints + the criterion (description, scale, levels) + transcript + selected
screenshots + extracted file text + console errors. Output: `{ score, pass, reason, evidence[] }` via
`responseFormat`. The built-in `goal_reached` criterion is binary and required; the judge's verdict on it
overrides the simulator's own `end_conversation` claim.
