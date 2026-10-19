# Phase 6 — Simulator agent

Depends on: P0 only (uses `BrowserSession` contract + `ScriptedChatModel`). Wave 1 `[PARALLEL]`.
Commit: `feat(simulator): persona-driven user agent with browser tools and turn loop`

## Goal
`createSimulator(...)` builds a LangChain `createAgent` whose tools act on a `BrowserSession`, speaks as the
persona, pursues the scenario goal, and stops on `end_conversation`, `max_turns` or error — emitting one
step record per tool call and one transcript entry per message.

## Read first
`src/browser/types.ts`, `src/testing/{scripted-chat-model,fake-browser-session}.ts` + tests (createAgent patterns),
`src/schemas/{persona,scenario,target,run}.ts`, `docs/architecture.md` (perception model, run lifecycle),
`node_modules/langchain/dist/agents/{types,middleware}.d.ts` (`createMiddleware`, `wrapModelCall`, `toolCallLimitMiddleware`).

## Deliverables
- `src/agents/simulator/prompt.ts` — `buildSimulatorSystemPrompt({ persona, scenario, target, turn, maxTurns })`: persona frontmatter + body verbatim; scenario goal/intent/context/examples (as inspiration, "never copy examples verbatim"); success criteria; target hints; rules: stay in character, one message per turn, use `snapshot` before acting when unsure, call `send_message` to talk, call `end_conversation` when success criteria are met or you would give up as this person; language = persona.language; vision-mode addendum when enabled.
- `src/agents/simulator/tools.ts` — `createSimulatorTools({ session, recorder, vision })` returning `tool()`s matching `ActionSchema` kinds: `snapshot`, `click`, `type`, `press`, `scroll`, `wait`, `send_message` (composite: find the message textbox from the latest snapshot — ref whose role is `textbox` and name matches /message|chat|ask|type/i, else the only textbox; type + submit; `waitForReplyStable` with target timeouts and `onInterim` → recorder; diff the new tree vs previous to extract the bot reply text (new lines after the user's text; fallback: last N new text nodes); returns the reply), `read_conversation` (returns the current tree's text), `download`, `upload`, `end_conversation`, and when `vision`: `screenshot_view`, `click_at`, `type_at` (return text; the PNG goes via middleware). Every tool: records a `Step` through the `StepRecorder` interface (`{ begin(action) → stepId; attachBefore/After(png); attachSnapshot(tree); attachInterim(png); end(resultText | error) }`), truncates results to 4 kB.
- `src/agents/simulator/recorder.ts` — `StepRecorder` interface + `InMemoryStepRecorder` (P10 provides the RunStore-backed one).
- `src/agents/simulator/middleware.ts` — `visionMiddleware(sessionRef)`: `wrapModelCall` appending a `HumanMessage` with `{type:"image", data, mimeType:"image/png"}` of the latest screenshot when the last tool call was `screenshot_view`; `turnBudgetMiddleware`: `beforeModel` injects a system note "Turn k of N" and, at N reached without `end_conversation`, forces a final `end_conversation(reason:"blocked")` by returning a jumpTo/end (see `createMiddleware` docs) — alternatively the loop in `run.ts` enforces it; pick one and test it.
- `src/agents/simulator/run.ts` — `runSimulator({ resolved, session, model, recorder, onMessage, signal })` → `{ reason, summary, turnsUsed, transcript }`: `createAgent({ model, tools, systemPrompt, middleware: [toolCallLimitMiddleware({ threadLimit: maxTurns * 8 }), ...] })`, invoked once with an initial `HumanMessage("Begin the conversation.")`; turn counting = successful `send_message` calls; stops when `end_conversation` was called or `turnsUsed === max_turns` (then `reason: "max_turns"`).
- `src/agents/simulator/index.ts`; `changelog.d/phase-06-simulator.md`.

## Seams & TDD slices (ScriptedChatModel + FakeBrowserSession; no Chromium)
1. System prompt contains persona body, goal, success criteria, "Turn 1 of 6", target hints, language.
2. Scripted tool calls `send_message("need my invoice")` → fake session records `type(e1, …, {submit:true})` + `waitForReplyStable`; tool returns the fake reply; transcript has user+bot entries with `turn: 1`; a `Step` with `action.kind === "send_message"` and before/after screenshots exists.
3. `end_conversation(goal_reached)` ends the loop with `reason: "goal_reached"`, `turnsUsed: 1`.
4. Script that keeps sending messages: loop stops at `max_turns` with `reason: "max_turns"`; no extra `send_message` executed after the budget.
5. `download(ref)` records a step and returns filename/bytes; unscripted download error becomes the tool result (`error:` text), not a crash.
6. Vision disabled → no `click_at` tool bound (assert via `model.boundToolNames()`); enabled → bound, and after `screenshot_view` the next model call's last message contains an `image` block (assert on `model.calls`).
7. Unknown ref error from the session is returned to the model as text and the loop continues.

## Commands
`npm test -- src/agents/simulator` · `npm run verify`

## Definition of done
- [ ] Seams 1–7 green; no Chromium; no live LLM.
- [ ] Reply extraction heuristic unit-tested with 3 snapshot shapes (list of paragraphs, log role, nested divs).
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
