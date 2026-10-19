# Architecture

Status: draft written in Phase 0; the runner section is updated in Phase 10.

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
| `src/agents/simulator` | `createSimulator(resolved, session, model)` → turn loop | P6 |
| `src/agents/judge` | `judgeRun(resolved, store, models)` → `Verdict` | P7 |
| `src/runner` | `Runner`, `RunEvent` | P10 |
| `src/report` | `renderReport(run, verdict, steps, …)` | P5 |
| `src/server` | Hono app factory | P8 |
| `src/cli` | commander program | P11 |

Contracts in `*/types.ts` are frozen after P0 (see `docs/plans/README.md`, rule 6).

## Run lifecycle

1. **setup** — resolve scenario (persona, target, rubric, evaluator, settings), create run dir, launch browser, open target URL, optional login steps.
2. **turn loop** — simulator agent decides the next action; every tool call is a *step* (before/after screenshot, snapshot, action.json). `send_message` ends a *turn*: it types, submits, waits for the reply to stabilise (interim screenshots), and records user + bot transcript entries. The loop stops on `end_conversation`, `max_turns`, or a fatal error.
3. **collect** — drain console/network logs, finalise downloads, close browser.
4. **judge** — deterministic criteria first, then file extraction, evidence selection (≤ `max_images`), per-criterion LLM calls with structured output, aggregation via `computeOutcome`.
5. **report** — render `report.html`, `summary.json`, `junit.xml`; emit `done`.

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
