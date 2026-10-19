# Phase 10 — Runner orchestration (LangGraph)

Depends on: P1 P2 P4 P5 P6 P7 (Wave 2). Commit: `feat(runner): LangGraph run orchestration with events, repeats and concurrency`

## Goal
Implement `Runner` (`src/runner/types.ts`): resolve the scenario, create the run dir, drive the simulator,
collect evidence, judge, render the report, and emit `RunEvent`s — with `repeat`, `concurrency`, cancellation
and robust error handling. Also publish the public API in `src/index.ts`.

## Read first
`src/runner/types.ts`, `src/schemas/run.ts` (RunRecord, RunEvent), `docs/architecture.md` (run lifecycle), the
`index.ts` of workspace/browser/config/simulator/judge/report, `@langchain/langgraph` `StateGraph` + `getWriter`
(`streamMode: ["updates", "custom"]`).

## Deliverables
- `src/runner/graph.ts` — `StateGraph` nodes `setup → converse → collect → judge → report` with state `{ runId, resolved, turnsUsed, simulatorOutcome, error }`; `converse` wraps `runSimulator` with a `RunStore`-backed `StepRecorder` (`src/runner/recorder.ts`: writes before/after/interim PNGs, snapshot, action.json; emits `step`, `message`, `download`, `turn` events via `getWriter()`); `judge` calls `judgeRun` with `onCriterion` → `criterion` events; `report` renders and saves files, emits `done`.
- `src/runner/runner.ts` — `createRunner({ workspace, runStore, browserFactory, modelFactory, logger })`: `start()` resolves the scenario (errors → `RunPreconditionError`), expands `repeat` (scenario.repeat × request.repeat), creates `RunRecord`s (ids `YYYYMMDD-HHMMSS-<scenario>-<4 hex>`), queues them with a semaphore of `settings.concurrency`, streams the graph and fans events out to `subscribe` listeners **and** `runStore.appendEvent`; `cancel()` aborts via `AbortSignal` (browser closed, status `ERROR` with `error: "cancelled"`); `active()`.
- Status transitions written to `run.json`: PENDING → RUNNING → JUDGING → PASSED|FAILED|ERROR; `simulator_outcome` recorded; `turns_used`; `score`.
- Login flow: when `target.auth.login_steps` is set, run a short pre-conversation simulator pass (`turn 0`) with the login instructions (reuse `runSimulator` with a login-specific prompt) — keep minimal.
- `src/index.ts` — export `createRunner`, `openWorkspace`, `openRunStore`, `createApp`, `LangChainModelFactory`, `PlaywrightSessionFactory`, `renderHtml`, plus existing exports.
- `changelog.d/phase-10-runner.md`; update `docs/architecture.md` run-lifecycle section if anything changed.

## Seams & TDD slices (FakeBrowserSession factory + ScriptedChatModel factory + temp workspace from templates)
1. Happy path: scripted simulator (`send_message` → `download` → `end_conversation(goal_reached)`) + scripted judge → final `run.json` PASSED, `verdict.json`, `report.html`, `steps/001..`, `transcript.jsonl`, `events.jsonl` containing `run_started … done` in order; listeners received the same events.
2. `max_turns` exhaustion: simulator script keeps talking → status FAILED, `simulator_outcome.reason === "max_turns"`, verdict present.
3. Browser throws during `open` → status ERROR, `error` set, `error` event `fatal: true`, no `verdict.json`, browser closed.
4. `repeat: 3` with `concurrency: 2` → three run ids, at most two browser sessions alive at once (factory counts), all complete.
5. `cancel(runId)` mid-conversation → ERROR/cancelled, session closed.
6. Precondition: unknown scenario → `RunPreconditionError` from `start`, nothing written.

## Commands
`npm test -- src/runner` · `npm run verify`

## Definition of done
- [ ] Seams 1–6 green with fakes; one integration test runs the graph against the real `PlaywrightSessionFactory` and the demo chatbot fixture started in-process (skip if `AE_SKIP_BROWSER=1`).
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
