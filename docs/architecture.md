# Architecture

Status: reflects the 0.1.0 code base (final pass in Phase 14).

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

The CLI (`run`) and the server (`serve`) build the same object graph: `openWorkspace` +
`openRunStore` + `createRunner({ browserFactory: PlaywrightSessionFactory, modelFactory:
LangChainModelFactory })`. The server adds `createApp(deps)` on top; the UI talks only to `/api`.

## Modules and contracts

| Module | Contract | Notes |
| --- | --- | --- |
| `src/schemas` | zod schemas for every file and artifact, REST DTOs, `computeOutcome`, `withBuiltinCriteria` | Shared vocabulary of server, agents and UI |
| `src/workspace` | `Workspace` (`openWorkspace`), `RunStore` (`openRunStore`) | Filesystem implementations; `resolve(name)` joins scenario + persona + target + rubric + evaluator + settings |
| `src/browser` | `BrowserSession`, `BrowserSessionFactory` (`PlaywrightSessionFactory`) | a11y refs, screenshots (plain + annotated), downloads, uploads, console/network drains, `waitForReplyStable`; `resolveChromiumExecutable` |
| `src/config` | `SecretsProvider` (`EnvSecretsProvider`), `ProviderRegistry`, `ModelFactory` (`LangChainModelFactory`), `resolveSettings`, `runDoctor` | `effort.ts` maps the unified effort level per provider |
| `src/agents/simulator` | `runSimulator({ resolved, session, model, recorder, onMessage?, onDownload?, signal? })` → `SimulatorResult` | Browser tools, `StepRecorder`, turn-budget and vision middleware |
| `src/agents/judge` | `judgeRun(input, deps)` → `Verdict` | Deterministic criteria, extractors, evidence selection, prompt builder |
| `src/report` | `renderReport(input, options?)` → `{ "report.html", "summary.json", "junit.xml" }` | Pure renderers, no filesystem access |
| `src/runner` | `createRunner(deps)` → `RunnerHandle` (`Runner` + `wait`, `close`); `RunEvent` | One LangGraph graph per run, `RunStoreStepRecorder`, `enforceTurnBudget` |
| `src/server` | `createApp(deps)` → Hono app, `startServer(options)` | REST + SSE, serves `dist/ui`; in-memory doubles in `testing.ts` |
| `src/cli` | `buildCli(deps)`, `runCli(argv, deps)` | commander; `CliDeps` makes every side effect injectable |
| `src/testing` | `ScriptedChatModel`, `FakeBrowserSession` | Test doubles used by every layer |
| `ui/` | Vite + React SPA | Typed client over `src/schemas/api.ts`, msw mocks |
| `fixtures/demo-chatbot` | `createDemoApp()`, `startDemo(port)` | The target of the E2E suite and the quick start |

Contracts in `*/types.ts` were frozen after P0; the additive changes made since are recorded in
[ADR-0003](./decisions/ADR-0003-contract-additions.md).

## Run lifecycle

`start(request)` resolves the scenario (persona, target, rubric with built-in criteria, evaluator,
settings) and builds the simulator / judge models — any failure there is a `RunPreconditionError`
and nothing is written. It then expands `scenario.repeat × request.repeat` into run records
(`PENDING`, ids `YYYYMMDD-HHMMSS-<scenario>-<4 hex>`), queues them behind a `settings.concurrency`
semaphore and returns the ids immediately.

Each run is one LangGraph `StateGraph` (`src/runner/graph.ts`) streamed with
`streamMode: ["updates", "custom"]`; nodes push `RunEvent`s through the custom writer and the runner
appends every event to `events.jsonl` **before** fanning it out to `subscribe` listeners, so SSE late
joiners replay exactly what live clients saw. Nodes never throw: a failure lands in `state.error`,
the graph routes to `collect` (which always closes the browser) and ends.

1. **setup** — `run.json` → `RUNNING` (`run_started`, `status` events); write `scenario.snapshot.yaml`;
   create the browser session (`headless` = request override, else `settings.browser.headless && target.headless`;
   `auth.storage_state` resolved against the workspace root); `open(target.url)`; when
   `auth.login_steps` is set, run a one-turn simulator pass whose steps are recorded as turn 0
   (credentials from `auth.credentials_env` are read from the environment and handed to that pass).
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
   event per scored criterion (deterministic first); `enforceTurnBudget` forces `goal_reached` to
   fail when the simulator ran out of turns; `verdict.json` is saved. Judge-model errors end the
   run as `ERROR`.
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
  scenario.snapshot.yaml    resolved scenario + persona + target + rubric + evaluator at run time
  events.jsonl              every RunEvent
  transcript.jsonl          TranscriptEntry per line (bot entries carry latency_ms)
  console.jsonl             ConsoleEntry per line (tagged with the step index)
  steps/NNN/before.png | after.png | interim-K.png | snapshot.txt | action.json
  downloads/<file>          saved attachments (+ downloads.json index with text_excerpt)
  verdict.json
  report.html | summary.json | junit.xml
```

`RunStore` guards every artifact path against traversal; the server exposes the directory through
`GET /api/runs/:id/artifacts/*`.

## Perception model

Default: `page.ariaSnapshot({ mode: "ai" })` yields a YAML accessibility tree with `[ref=eN]` markers;
tools act through `page.getByRef("eN")` and refs must come from the latest snapshot. This is
provider-agnostic (no vision model required) and cheap. `send_message` finds the chat textbox in
the latest snapshot, types (waiting for a disabled composer to become editable), submits, then
`waitForReplyStable` polls the tree until it is unchanged for `stable_ms` with no request younger
than `stable_ms` in flight, taking interim screenshots every `capture_interval_ms`; the bot reply is
the diff between the trees before and after.

Vision mode (per target/scenario) adds `screenshot_view`, `click_at`, `type_at`; screenshots are
injected as `{ type: "image", data, mimeType: "image/png" }` content blocks in a trailing
`HumanMessage` by a `wrapModelCall` middleware — never inside `ToolMessage`s, which several providers
reject. Annotated screenshots label each ref with its number so x/y and ref tools can be mixed.

## Judge inputs (D8)

`evaluator.principles` + scenario (`goal`, `intent`, `context`, `success_criteria`, `max_turns`, `turns_used`)
+ persona summary + target hints + the criterion (description, scale, levels) + transcript + selected
screenshots (`evidence_selection`: `llm` selector model or `uniform`, capped at `max_images`) +
extracted file text + console errors. Output: `{ score, pass, reason, evidence[] }` via structured
output, one call per LLM criterion; deterministic criteria are computed in code first. The built-in
`goal_reached` criterion is binary and required; the judge's verdict on it overrides the simulator's
own `end_conversation` claim, and the runner overrides both when `max_turns` was exhausted.

## Model selection

`ProviderRegistry.configured(secrets)` limits the offer to providers whose environment variable is
set; `listModels` fetches live model lists (10-minute cache, `examples` fallback). `LangChainModelFactory`
builds models per role from `provider:model` references, applies `effortParams` (`src/config/effort.ts`)
and the optional temperature, and sets the output-token limit to the model profile's maximum. The
UI never sees secret values (ADR-0002).
