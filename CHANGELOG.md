# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/).

During development each change adds a fragment under `changelog.d/` instead of editing this file
(avoids merge conflicts between parallel branches). Fragments are assembled into a release section
at release time.

## [Unreleased]

See `changelog.d/`.

## [0.1.0] — 2026-10-19

First release: the complete pipeline from workspace files to a scored HTML report, driven by a
persona-based simulator on real Chromium and a hybrid deterministic/LLM judge, with a CLI for CI and
a local web UI.

### Added

#### Project scaffold and contracts
- Project scaffold: TypeScript (strict, ESM), Biome, Vitest projects (`unit`, `ui`, `e2e`), tsdown build, Vite UI build, CI workflow (Node 24/26).
- Zod schemas for personas, scenarios, rubrics, targets, evaluator config, settings, run artifacts and REST DTOs (`src/schemas`).
- Frozen module contracts: `BrowserSession`, `Workspace`/`RunStore`, `SecretsProvider`/`ModelFactory`, `Runner`/`RunEvent`.
- Test doubles: `ScriptedChatModel` (works with `createAgent` tool loops and `responseFormat`) and `FakeBrowserSession`.
- Shipped templates (`templates/`) validated by tests.
- Phase plans and briefs under `docs/plans/`, architecture overview and ADRs.

#### Workspace and run store
- `FsWorkspace` (`openWorkspace`): initialises the directory layout from the shipped templates, lists resources, loads and validates personas (Markdown + YAML frontmatter), scenarios, rubrics, targets, `evaluator.yaml` and `agent-evaluator.yaml`, offers raw read/validate/write/remove for editors, and resolves a scenario with its persona, target (overridable), rubric (scenario or `default_rubric`, built-in criteria applied), evaluator config and settings.
- `FsRunStore` (`openRunStore`): persists `runs/<id>` evidence — atomic `run.json` writes, zero-padded `steps/NNN/` screenshots, snapshots and actions, JSONL transcript/console/events, `downloads/` with a `downloads.json` index, verdict and report files — and guards artifact paths against traversal.
- `splitFrontmatter` / `joinFrontmatter` helpers for persona files.

#### Browser
- `PlaywrightSession` / `PlaywrightSessionFactory` (`src/browser`): Chromium-backed `BrowserSession` that perceives pages through `ariaSnapshot({ mode: "ai" })` refs, acts via `getByRef`, captures viewport screenshots (plus an annotated variant with numbered ref labels for vision mode), saves downloads with sniffed mime types, uploads through the file chooser, drains console messages and network failures, lists newly rendered images and detects when a streamed reply has stabilised (`waitForReplyStable` with interim screenshots and in-flight request tracking).
- `BrowserSessionOptions.executablePath` (additive) and the `AE_CHROMIUM_PATH` environment variable to point at a Chromium binary when Playwright's bundled build is not installed.
- `src/browser/test-server.ts`: ephemeral `node:http` fixture server for browser tests.

#### Demo chatbot
- Demo chatbot fixture (`fixtures/demo-chatbot`, `npm run demo`, port 3999 / `DEMO_PORT`): a dependency-free Hono app with a vanilla-JS, accessible chat page (`role="log"` message list, `aria-label="Message"` textarea, "Send" button, Enter submits, `aria-label="Attach file"` upload input, "Download" buttons on bot messages with attachments).
- Scripted, deterministic `reply(history, mode)` brain: greeting, customer-number and month collection, invoice delivery as `/api/invoice/<month>.pdf`, polite fallback; failure modes via `?mode=normal|slow|offtopic|broken|noattach`.
- Routes: `GET /` (chat page), `POST /api/chat` (SSE token stream: `token` / `done` / `error` events), `GET /api/invoice/:month.pdf` (hand-rolled minimal PDF, ≥ 500 bytes, titled "Invoice <Month> 2026"), `POST /api/upload` (multipart, echoes the file name), `GET /api/reset`, `GET /api/state`.
- `createDemoApp()` / `startDemo(port)` exports so tests and the E2E suite can run the fixture in-process; unit tests for the brain, the PDF writer and the server (`app.request()`).

#### Configuration, secrets and models
- `src/config`: `EnvSecretsProvider` (environment only; loads an existing workspace `.env` via `process.loadEnvFile`, never writes) and `StaticSecretsProvider` for tests.
- Provider registry (`createProviderRegistry`, `PROVIDERS`, `parseRef`) for anthropic, openai, google-genai, openrouter, xai, mistralai, groq and ollama: presence-only status, `configured()` limited to providers whose env var is set, and live model listing from each provider API mapped to `ModelInfo` (10-minute in-memory cache, `examples` fallback with `source: "fallback"` and a redacted `error`, never throws).
- `LangChainModelFactory` (`forRole` / `fromRef`): `openrouter:` builds `ChatOpenRouter` directly, every other provider goes through `initChatModel`; `effortParams` maps the unified `effort` level onto each provider's reasoning knob; output tokens default to the model profile's `maxOutputTokens`; `ProviderNotConfiguredError` names the missing env var before any provider call.
- `resolveSettings` with precedence file < environment (`AE_PORT`, `AE_RUNS_DIR`, `AE_HEADLESS`, `AE_MODEL_SIMULATOR`, `AE_MODEL_JUDGE`) < CLI overrides, validated by `SettingsSchema`.
- `runDoctor` checks: provider keys, Chromium executable, workspace layout and whether each configured model points at a configured provider, with fix hints.

#### Report
- Report renderers (`src/report`): `renderHtml` produces a self-contained `report.html` (inline CSS, system fonts, light/dark, no external assets) with a status badge, percentage score gauge, pass threshold, turns used/max, criteria table with evidence links, per-turn transcript screenshots, a filmstrip of every step including interim captures, downloads with extracted excerpts, console errors, judge summary and goal assessment, and the raw JSON in a collapsible; screenshots are referenced by relative path or inlined as `data:` URIs through an injected loader.
- `renderSummary` (`summary.json`) and `renderJUnit` (`junit.xml`, one `<testcase>` per criterion with `<failure>` on fail; a FAILED run without failing criteria or an ERROR run adds a `run` testcase), plus `renderReport` bundling all three files for `RunStore.saveReport`.
- Golden `ReportInput` fixtures (PASSED, FAILED on `max_turns`) validated by `ReportInputSchema`, and a file snapshot of the PASSED report.

#### Simulator agent
- Simulator agent (`src/agents/simulator`): `runSimulator({ resolved, session, model, recorder, onMessage, onDownload, signal })` builds a LangChain `createAgent` whose tools drive a `BrowserSession` as the persona, pursues the scenario goal and stops on `end_conversation`, `max_turns`, an exhausted tool-call budget (`blocked`) or an error.
- Browser tools matching the `ActionSchema` kinds (`snapshot`, `click`, `type`, `press`, `scroll`, `wait`, `send_message`, `read_conversation`, `download`, `upload`, `end_conversation`; `screenshot_view`, `click_at`, `type_at` in vision mode). `send_message` finds the chat textbox from the latest snapshot, submits, waits for the reply to stabilise (interim screenshots) and extracts the bot reply by diffing accessibility trees. Every tool call records a `Step` with before/after screenshots and a 4 kB-truncated result.
- `StepRecorder` interface + `InMemoryStepRecorder`; `buildSimulatorSystemPrompt` with a live "Turn k of N" counter; `turnBudgetMiddleware` (prompt refresh, stop after `end_conversation`, hard stop at `max_turns`) and `visionMiddleware` (screenshot as an `image` block in a trailing `HumanMessage`).

#### Judge agent
- Judge agent (`src/agents/judge`): `judgeRun(input, deps)` scores a finished run against its rubric and returns a `Verdict`.
- Deterministic criteria computed in code: `contains`, `regex` (bot / user / files / any scopes), `file` (MIME glob, `min_bytes`, `contains` on extracted text), `max_response_time_ms` (`max` / `p95` / `p50` over bot latencies) and `no_console_errors` (with `ignore` patterns), each with `raw` measurements and evidence references.
- File extractors (`extractText`): PDF via `unpdf`, DOCX via `mammoth`, CSV via `csv-parse` (first 50 rows), `text/*` as-is, images and unknown binaries as empty text; capped at 20 kB and never throwing.
- Evidence selection (`selectEvidence`): `uniform` (evenly spaced screenshots, first and last always kept) or `llm` (selector model picks key steps via structured output), clamped to `max_images` and falling back to `uniform` on any selector failure.
- Prompt composition per decision D8 (`buildJudgePrompt`, pure and snapshot-tested): principles, scenario, persona summary, target hints, criterion with scale and levels, transcript, extracted file text, console errors, attached screenshot list and a G-Eval style "list the evaluation steps, then score" instruction. `goal_reached` additionally gets the turn budget and the simulator's own claim with the instruction that the judge's assessment overrides it.
- LLM criteria scored one by one through `withStructuredOutput` with screenshots attached as base64 image blocks; scores normalised to 0..1 (binary → 0/1, 0-5 → /5); `onCriterion` callback for live UIs; aggregation via `computeOutcome`.

#### Server
- Hono server (`src/server`): `createApp(deps)` exposing every `/api` route from `src/schemas/api.ts` — workspace overview and resource CRUD (personas, scenarios, rubrics, targets, evaluator, settings), `POST /api/validate`, template downloads, provider presence and live model listing (configured providers only, secret values redacted), run start/list/detail/cancel, run artifacts and `report.html`.
- `GET /api/runs/:id/events`: Server-Sent Events that replay `events.jsonl` history, then stream live `RunEvent`s with periodic heartbeat comments and close on `done` or a fatal `error`.
- Static SPA serving from `dist/ui` with SPA fallback to `index.html`; JSON `404` bodies only under `/api`.
- `startServer({ app, host, port })` on `@hono/node-server` with pino logging and graceful SIGINT/SIGTERM shutdown.
- In-memory test doubles for the contracts (`src/server/testing.ts`): `InMemoryWorkspace`, `InMemoryRunStore`, `FakeRunner` (with `emit`), `FakeProviderRegistry`, `FakeSecrets` and `createFakeDeps()`.

#### Runner
- Runner (`src/runner`): `createRunner({ workspace, runStore, browserFactory, modelFactory, logger?, now? })` implements the frozen `Runner` contract plus two additive helpers, `wait(runId)` (resolves with the final `RunRecord`) and `close()` (cancels in-flight runs and closes the browser factory).
- One LangGraph `StateGraph` per run, `setup → converse → collect → judge → report`: `setup` writes `scenario.snapshot.yaml`, opens the browser at `target.url` and runs `auth.login_steps` as a turn-0 simulator pass when set; `converse` drives `runSimulator` with a `RunStore`-backed `StepRecorder`; `collect` drains console/network logs and always closes the session; `judge` persists extracted `text_excerpt`s into `downloads.json`, calls `judgeRun` and saves `verdict.json`; `report` renders `report.html` (screenshots inlined), `summary.json` and `junit.xml`.
- `RunStoreStepRecorder`: writes `steps/NNN/{before,after,interim-K}.png`, `snapshot.txt` and `action.json`, tags drained console messages with the step index and emits a `step` event per closed step.
- Run lifecycle in `run.json`: `PENDING → RUNNING → JUDGING → PASSED | FAILED | ERROR` with `turns_used`, `simulator_outcome`, `score`, `finished_at` and `error`. Simulator reasons `gave_up`, `blocked` and `max_turns` are judged (the verdict decides the status); `error` ends the run as `ERROR` without judging. A run that exhausted `max_turns` cannot pass: `goal_reached` is forced to fail and the outcome recomputed (`enforceTurnBudget`).
- Events (`run_started`, `status`, `log`, `turn`, `message`, `step`, `download`, `judge_started`, `criterion`, `done`, `error`) are appended to `events.jsonl` before being fanned out to `subscribe` listeners, so SSE late joiners replay exactly what live clients saw.
- `repeat` expansion (`scenario.repeat × request.repeat`, ids `YYYYMMDD-HHMMSS-<scenario>-<4 hex>`), a `settings.concurrency` semaphore, `cancel(runId)` via `AbortSignal` (status `ERROR`, `error: "cancelled"`, browser closed) and `RunPreconditionError` for unknown scenarios/targets or unconfigured model providers (nothing is written in that case).
- Public API (`src/index.ts`) exports `createRunner`, `openWorkspace`, `openRunStore`, `createApp`, `startServer`, `createProviderRegistry`, `LangChainModelFactory`, `EnvSecretsProvider`, `resolveSettings`, `runDoctor`, `PlaywrightSessionFactory`, `renderReport`, `renderHtml`, `runSimulator`, `judgeRun` and `VERSION`.
- Test doubles for downstream code (`src/runner/testing.ts`): `FakeSessionFactory` (counts live sessions), `SlowFakeSession`, `ScriptedModelFactory` and `makeTempWorkspace`.

#### CLI
- CLI (`src/cli`, bin `agent-evaluator`): `init [dir] [--force]`, `serve [--port] [--host] [--workspace] [--open]`, `run <scenario...> [--target] [--repeat N] [--headed] [--json] [--fail-on-error] [--workspace]`, `validate [--workspace]`, `report <runId> [--open] [--workspace]`, `templates [--out dir] [--kind kind]` and `doctor [--workspace]`.
- `run` streams progress to stderr from runner events (turn k/N, step actions, messages, downloads, per-criterion ✓/✗ with reasons, final verdict), prints a summary table (scenario, status, score %, turns, report path) to stdout, `--json` prints the `summary.json` objects as a JSON array (runs that ended in `ERROR` get a synthesized entry with `error`), and exits 1 when any run is `FAILED` or `ERROR`. Scenarios are resolved before anything starts, so a typo writes nothing; `--fail-on-error` cancels the runs still pending after the first `ERROR`.
- `serve` wires `EnvSecretsProvider`, the provider registry, `LangChainModelFactory`, `PlaywrightSessionFactory`, the runner and `createApp({ version: VERSION })`, prints the URL and closes the server and the runner on SIGINT/SIGTERM.
- `doctor` prints every `runDoctor` check as ✓/✗ with its fix hint and exits 1 only for blocking problems (a configured model role whose provider has no key, or Chromium missing). The Chromium check honours `AE_CHROMIUM_PATH` like the browser factory.
- `validate` checks every file (`validateRaw`), that `name:` matches the file name, and the cross-references of each scenario through `workspace.resolve`; issues are listed as `<path>: <field>: <message>`.
- `report` re-renders `report.html`, `summary.json` and `junit.xml` from the stored artifacts using `scenario.snapshot.yaml` (falls back to the current workspace files).
- Settings precedence file < environment (`AE_*`) < flags via `resolveSettings`; the resolved settings reach the runner and the API.
- `src/cli/output.ts`: colour palette honouring `NO_COLOR`/`FORCE_COLOR`/TTY, fixed-width table, truncation; `src/cli/testing.ts`: `createCliHarness` (captured output, exit code instead of `process.exit`) and `fakeRunnerFactory` (scripted models + fake browser) for the E2E suite.

#### Web UI
- UI application shell (`ui/`): design tokens with light/dark themes, reduced-motion support and a visible focus ring; sidebar layout that collapses to a top strip below 760 px; skip link.
- Client-side routes for dashboard, personas, scenarios, rubrics, targets, evaluator, settings, runs and run detail, with a root error boundary and route-level code splitting (the editors and run pages load on demand; main chunk ~330 kB).
- Typed API client (`api.get/put/post/del/putText` + route-typed `endpoints`) mapping 422 bodies to `ApiValidationError` and other failures to `ApiError`; `subscribeRunEvents` SSE helper validating events with `RunEventSchema`.
- Reusable components: `Button`, `Field`, `Panel`, `PageHeader`, `StatusBadge`, `ScoreGauge` (accessible meter).
- Resource list pages for personas, scenarios, rubrics and targets: name/description/updated table, inline delete confirmation, "New from template" (slug prompt → editor pre-filled from `GET /api/templates/:kind`), template download links and file upload (read → `POST /api/validate` → `PUT` raw text).
- Split **form ⇄ source** editors kept in sync in both directions (the file text is the single source of truth; form edits re-serialise it): persona (frontmatter form + Markdown body with section hints), scenario, rubric (criteria list with type-specific fields, live weighted-score preview using the judge's aggregation incl. the built-in `goal_reached`), target (URL/hints/timeouts/viewport/auth env-var names) and evaluator (principles, max images, default rubric select, evidence selection).
- Validation on blur and before save through `POST /api/validate`; issues shown inline next to the field (`aria-invalid` + `aria-describedby`) and in an issues summary; saving sends the raw text so hand-written YAML comments survive; unsaved changes warn on page unload.
- Settings page: per role (`simulator`, `judge`, `evidence_selector`) a provider → model → effort cascade fed by `GET /api/providers` (configured only) and `GET /api/providers/:id/models` with refresh, a "fallback list" notice and a model card (context window, max output, images, reasoning); optional temperature; browser headless/slow-mo, concurrency and runs dir; `browser_installed` warning with the install command; empty state explaining env vars and vault options.
- **Runs page** (`/runs`): table of every run (scenario, persona, target, status badge, score ring, turns, start time, duration) with scenario and status filters kept in the query string, and a "Run scenario" dialog (scenario, target override, repeat, headed browser) that posts to `POST /api/runs` and opens the first run. `/runs?launch=1` opens the dialog directly.
- **Live run view** (`/runs/:id`): status, turn k/N and an elapsed timer; an evidence strip of step screenshots that grows as `step` events arrive (click one for the full image, the action JSON and the accessibility snapshot); transcript with bot reply latency; downloads with links to the artifacts; criteria filling in as the judge scores them; a cancel button; and, once the run is done, the score gauge, summary and the standalone report embedded from `/api/runs/:id/report`. Fatal errors are explained in place, a "Reconnecting…" indicator shows while the browser re-establishes the SSE stream (the server replays history, so reloads are safe), and finished runs render from the stored record plus the persisted `events.jsonl` without opening a stream.
- **Dashboard** (`/`): the last ten runs, pass rate per scenario derived client-side from `GET /api/runs`, and quick links to launch a run and browse.
- Pure `applyRunEvent` reducer (`ui/src/runs/reducer.ts`) keyed so SSE replays are idempotent; event bursts are folded in one `startTransition` per microtask.
- Pure, unit-tested conversion helpers in `ui/src/editors/` (YAML and persona codecs, list helpers, issue mapping, rubric preview, settings draft, template naming), `useDocumentEditor` / `useAsync` hooks, and an msw mock API for the `ui` Vitest project covering every documented `/api` route with fixtures built from the shipped templates.

#### End-to-end tests and CI
- End-to-end suite (`e2e/`, `npm run test:e2e`, Vitest project `e2e`): the whole pipeline on a real Chromium against the in-process demo chatbot with deterministic scripted models. `e2e/helpers.ts` starts the demo on a free port, builds a throwaway workspace from the shipped templates with `target.url` rewritten to that port (fast `stable_ms` / `capture_interval_ms`), and wires `createRunner` with `PlaywrightSessionFactory` and a `ScriptedModelFactory`.
- `e2e/pipeline.test.ts`: PASSED verdict with `pdf_delivered` passing on a ≥ 500-byte PDF, `report.html` with a percentage, a screenshot per step and interim screenshots for the streamed reply, a 1 user + 1 bot transcript, the event stream and two runs through one runner.
- `e2e/failure-modes.test.ts`: `?mode=noattach` → `pdf_delivered` fails → FAILED with the criteria breakdown; `?mode=broken` → truncated reply, the SSE error captured as a console error → `clean_console` fails, run still judged; `max_turns: 1` with a chatty simulated user → FAILED with `simulator_outcome.reason = "max_turns"` even though the scripted judge claimed success.
- `e2e/cli.test.ts`: `init`, `validate`, `templates`, `doctor` and `run <unknown>` as real `node dist/cli.js` child processes (exit codes, text output, no provider keys), plus `run --json` in-process through `runCli` with a scripted runner injected via `CliDeps.createRunner` (PASSED → exit 0, FAILED → exit 1, summary JSON).
- `e2e/live.test.ts`: opt-in smoke test (`AE_LIVE_LLM=1`, `npm run test:live`) that builds real models through `LangChainModelFactory` from the environment (`AE_MODEL_SIMULATOR` / `AE_MODEL_JUDGE` honoured) and asserts only that a verdict and a rendered report exist.
- CI runs `npm run test:e2e` after the unit tests (workspaces kept under `test-results/e2e`) and uploads `runs/**/report.html` and `runs/**/verdict.json` with `actions/upload-artifact@v4` when a job fails. `AE_E2E_WORKSPACE_DIR` / `AE_E2E_KEEP=1` place and keep the E2E workspaces for inspection; Chromium resolution falls back to Playwright's default build when `AE_CHROMIUM_PATH` is unset.

#### Documentation and release
- README with how-it-works diagram, CLI reference, configuration reference tables for every workspace file, model selection and effort mapping, scoring rules, report formats and CI usage, known limitations, troubleshooting and roadmap; real screenshots under `docs/screenshots/` with a `capture.ts` script to regenerate them.
- `docs/architecture.md` final pass and ADR-0003 recording the additive contract changes and the turn-budget safety net.
- `release.yml` workflow publishing to npm with provenance on `v*.*.*` tags (`NPM_TOKEN` secret, added manually).

### Changed
- `ProviderDefinition.effortKnob` gains the `openrouter` value and `ProviderNotConfiguredError` is exported from `src/config/types.ts` (additive).
- `tsconfig.json` `include` lists `e2e/` and `docs/screenshots/` so `npm run typecheck` covers the E2E suite and the screenshot script.
- `.env.example` lists the variables the tool actually reads (`AE_PORT`, `AE_RUNS_DIR`, `AE_HEADLESS`, `AE_MODEL_*`, `AE_CHROMIUM_PATH`, `LOG_LEVEL`).

### Fixed
- `PlaywrightSession.type` waits (up to `navigation_ms`) for a disabled or read-only field to become editable before typing. Playwright's `press*` methods perform no actionability checks, so keystrokes sent to a chat input that is disabled while a reply streams were silently dropped — the simulator could send its first message during the bot's greeting and lose it.
- The demo chatbot disables the message input while a reply streams (visible as `[disabled]` in the accessibility tree) instead of silently discarding a message submitted too early.
- The CLI loads a plain `.env` from the working directory into `EnvSecretsProvider`, as documented under "Secrets"; previously only variables already present in the environment were seen.

[Unreleased]: https://github.com/numikel/agent-evaluator/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/numikel/agent-evaluator/releases/tag/v0.1.0
