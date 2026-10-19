# Phase 7 — Judge agent

Depends on: P0 only (uses schemas + `ScriptedChatModel`; reads artifacts via an injected reader, not `RunStore`). Wave 1 `[PARALLEL]`.
Commit: `feat(judge): deterministic and LLM criteria, evidence selection and verdict aggregation`

## Goal
`judgeRun(input, deps)` produces a `Verdict`: deterministic criteria computed in code, downloaded files
extracted to text, key screenshots selected (≤ `max_images`), each LLM criterion scored with structured
output against the fixed prompt composition (D8), aggregated with `computeOutcome`.

## Read first
`src/schemas/{rubric,run,evaluator,scenario}.ts` (`computeOutcome`, `withBuiltinCriteria`), `docs/architecture.md`
(judge inputs), `src/testing/scripted-chat-model.test.ts` (`responseFormat` with scripted tool calls), packages `unpdf`, `mammoth`, `csv-parse` (installed).

## Deliverables
- `src/agents/judge/types.ts` — `JudgeInput = { run: RunRecord, resolved, steps, transcript, downloads, console, readFile(rel): Promise<Uint8Array> }`, `JudgeDeps = { judgeModel, selectorModel?, now?, onCriterion? }`.
- `src/agents/judge/extractors.ts` — `extractText({ path, mime, bytes })`: pdf via `unpdf` (`extractText(await getDocumentProxy(buf))`), docx via `mammoth.extractRawText`, csv via `csv-parse/sync` → first 50 rows as text, text/* as-is, images → `""` (keep `mime`); cap 20 kB; never throws (returns `{ text: "", error }`).
- `src/agents/judge/deterministic.ts` — evaluators for `contains`, `regex`, `file` (mime glob, min_bytes, contains on extracted text), `max_response_time_ms` (aggregate over bot `latency_ms`), `no_console_errors` (level error minus `ignore` patterns). Each returns `CriterionResult` with `raw` and `evidence` (turn/step refs).
- `src/agents/judge/evidence.ts` — `selectEvidence({ steps, transcript, maxImages, strategy, selectorModel })`: `uniform` = evenly spaced steps that have a screenshot (always include first and last turn); `llm` = selector model receives the text transcript + step list and returns `{ steps: number[] }` via `withStructuredOutput`, clamped to `maxImages`, falls back to uniform on failure.
- `src/agents/judge/prompt.ts` — `buildJudgePrompt(...)` per D8 + G-Eval instruction ("first list the evaluation steps implied by the criterion, then score"); `LlmCriterionOutput = z.object({ score: number, pass: boolean, reason: string, evidence: [{ step?, turn?, quote? }] })`; score normalisation: binary → 0/1, 0-5 → /5, 0-1 as-is.
- `src/agents/judge/llm.ts` — `scoreLlmCriterion` using `createAgent({ model, tools: [], responseFormat: LlmCriterionOutput, systemPrompt })` **or** `model.withStructuredOutput(schema)` directly (simpler; choose and justify in code comment). Attach selected screenshots as `image` blocks (loaded through `readFile`) in the `HumanMessage`. `goal_reached` additionally receives `turns_used/max_turns` and the simulator's own `end_conversation` claim, with the instruction that the judge's assessment overrides it.
- `src/agents/judge/index.ts` — `judgeRun`: order = deterministic → extract files → select evidence → LLM criteria sequential (respect `onCriterion` callback for live UI) → `computeOutcome` → `Verdict` (`judge_model` = ref string, `evidence_screenshots`).
- `changelog.d/phase-07-judge.md`.

## Seams & TDD slices
1. `contains`/`regex` on bot vs user vs files scopes; `file` passes for a PDF fixture (generate a minimal PDF in the test) and fails on mime mismatch; `max_response_time_ms` with `p95`; `no_console_errors` honours `ignore`.
2. `extractText` for a generated PDF contains the embedded text; csv → rows; unknown binary → empty text without throwing.
3. `uniform` selection respects `maxImages` and includes first/last; `llm` selection parses the scripted `{steps}` and clamps.
4. LLM criterion with `ScriptedChatModel` (`structured: [{score: 4, pass: true, reason: "…", evidence: []}]`) → normalised 0.8; the prompt the model received contains principles, goal, success criteria, criterion description, levels, transcript lines and N image blocks.
5. `goal_reached` false when the judge says so even though the simulator claimed success; `Verdict.status` FAILED, criteria still listed; `max_turns` exhaustion is stated in the prompt.
6. Required deterministic failure (`pdf_delivered`) ⇒ FAILED with score > 0.
7. Selector model throwing ⇒ falls back to uniform (verdict still produced).

## Commands
`npm test -- src/agents/judge` · `npm run verify`

## Definition of done
- [ ] Seams 1–7 green; no live LLM; prompts snapshot-tested (`toMatchFileSnapshot`) for the template scenario.
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
