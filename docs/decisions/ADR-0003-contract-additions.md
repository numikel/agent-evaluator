# ADR-0003: Additive contract changes and safety nets recorded during implementation

Date: 2026-10-19 · Status: accepted

## Context

The module contracts (`src/{browser,workspace,config,runner}/types.ts`, `src/schemas/*`) were
frozen after Phase 0 so the phases could be implemented in parallel. A few additive changes turned
out to be necessary; this ADR records them so they are not mistaken for drift.

## Decisions

- **`BrowserSessionOptions.executablePath?`** (browser). Playwright's bundled Chromium is not
  always present (sandboxes, distro packages). Resolution order: this option → `AE_CHROMIUM_PATH`
  → Playwright's bundled build → an existing well-known binary, otherwise a clear install hint.
  `agent-evaluator doctor` uses the same resolution.
- **`PlaywrightSession.type` waits for the field to be editable** (browser, behaviour only).
  Playwright's `press`/`pressSequentially` perform no actionability checks, and chat UIs commonly
  disable the composer while a reply streams; keystrokes sent then are silently dropped. `type`
  now waits up to `navigationTimeoutMs` for the target to be neither `disabled`, `readOnly` nor
  `aria-disabled`, then throws a descriptive error. The `BrowserSession` interface is unchanged.
- **`ProviderDefinition.effortKnob` gains `"openrouter"`**, and `ProviderNotConfiguredError` is
  exported from `src/config/types.ts` (config). OpenRouter passes reasoning effort through
  `modelKwargs`, unlike the OpenAI-compatible providers. The unified `effort` mapping lives in
  `src/config/effort.ts` and is documented in the README ("Model selection").
- **`RunnerHandle = Runner & { wait(runId), close() }`** (runner). The CLI and the E2E suite need
  to await a run's final record and to shut the browser factory down; both are additive on top of
  the frozen `Runner` interface.
- **`enforceTurnBudget` safety net** (runner). Plan decision D7 says a conversation that exhausts
  `max_turns` is FAILED. The judge still scores every criterion for diagnostics, but when the
  simulator's outcome is `max_turns` the runner forces `goal_reached` to fail, recomputes the score
  with `computeOutcome` and appends an "Overridden" note to the goal assessment. This keeps the
  rule independent of the judge model's judgement.
- **Model-role fallback** (config). `evidence_selector` inherits the judge's model, effort and
  temperature when `models.evidence_selector` is unset, so the common configuration needs two
  references, not three.

## Consequences

- Downstream code can rely on these additions in 0.1.x; removing any of them is a breaking change.
- The vision-mode and login-flow paths exercise the same contracts but have less coverage than the
  accessibility-ref path (see README "Known limitations").
