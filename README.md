# agent-evaluator v0.1.0

**Automated, UI-level evaluation of chatbots and AI agents: a persona-driven simulated user drives your bot through a real browser, every step is captured as evidence, and an LLM judge scores the conversation against your rubric.**

![CI](https://github.com/numikel/agent-evaluator/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)
![Status](https://img.shields.io/badge/status-pre--release-orange.svg)

> Status: **Phase 0 (scaffold) complete.** The end-to-end pipeline lands in the following phases; see [`docs/plans/README.md`](./docs/plans/README.md).

## About

Testing a chatbot through its REST or SSE API tells you what the model said. It does not tell you
whether the download button worked, whether the streamed answer ever finished rendering, or whether a
real, impatient customer would have reached their goal in six messages.

`agent-evaluator` runs the test the way a user would:

1. A **simulator** agent takes on a persona (a Markdown file) and a scenario (a YAML file with a goal,
   an intent and a turn budget), opens the chatbot in Chromium and improvises the conversation. It
   reads the page through the accessibility tree, clicks, types, downloads attachments and takes a
   screenshot after every step.
2. A **judge** agent reads the transcript, the selected screenshots, the extracted content of
   downloaded files and the console log, and scores the run against a rubric of deterministic and
   natural-language criteria, taking your global evaluation principles into account.
3. A **report** (self-contained HTML, JSON, JUnit) shows the percentage score, PASS/FAILED, every
   criterion with its rationale and the evidence it cites.

A run that exhausts `max_turns` without reaching the goal is FAILED, but the rubric breakdown is still
produced so you can see what worked.

## Features

- ✅ Persona files in Markdown (`personas/*.md`) with YAML frontmatter, skill-style
- ✅ Scenarios in natural language (`scenarios/*.yaml`): goal, intent, examples, `max_turns`, expected artifacts
- ✅ Rubrics (`rubrics/*.yaml`) mixing LLM criteria with deterministic checks (regex, file/MIME, latency, console errors)
- ✅ Global judge principles in `evaluator.yaml`
- ✅ Hybrid browser perception: accessibility tree with element refs by default, optional vision mode
- ✅ Screenshot after every step plus interim captures while replies stream; downloads saved and parsed
- ✅ Any LLM provider supported by LangChain; only providers whose key is present in your environment are offered, models are listed live from the provider API, and a provider-agnostic `effort` level maps to each provider's reasoning knob
- ✅ Local server with a visual configuration UI, live run view and report viewer
- ✅ CLI for CI pipelines; JUnit output
- ⏳ Multi-judge voting, run trends, OS keychain secrets (planned, see roadmap in `docs/plans/README.md`)

## Requirements

- Node.js ≥ 22.13 (CI runs on 24 and 26)
- Chromium for Playwright: `npx playwright install chromium`
- An API key for at least one supported provider

## Installation

### Using npm (default)

```bash
npm install -g agent-evaluator
npx playwright install chromium
```

### From source

```bash
git clone https://github.com/numikel/agent-evaluator.git
cd agent-evaluator
npm ci
npx playwright install chromium
npm run build
```

## Quick start

```bash
mkdir my-bot-evals && cd my-bot-evals
agent-evaluator init          # creates personas/, scenarios/, rubrics/, targets/, evaluator.yaml, agent-evaluator.yaml
export ANTHROPIC_API_KEY=...  # or use a vault, see "Secrets"
agent-evaluator serve         # opens the UI on http://127.0.0.1:4747
```

Try it against the built-in demo chatbot first (`npm run demo` in this repository starts it on port 3999;
the `demo-chatbot` target template already points there).

## Configuration

All configuration is plain files in your workspace directory. Templates are shipped in
[`templates/`](./templates) and can be downloaded from the UI.

| File | Purpose |
| --- | --- |
| `personas/<name>.md` | Who the simulated user is: background, goals, communication style, knowledge, constraints |
| `scenarios/<name>.yaml` | What they want: `goal`, `intent`, `success_criteria`, `max_turns`, `expected_artifacts` |
| `rubrics/<name>.yaml` | What the judge scores: weighted criteria, `required` flags, `pass_threshold` |
| `targets/<name>.yaml` | The chatbot under test: `url`, optional auth, natural-language hints, timeouts |
| `evaluator.yaml` | Global judge principles, screenshot budget, default rubric |
| `agent-evaluator.yaml` | Models per role (`simulator`, `judge`), browser and server settings |

### Secrets

API keys are read from environment variables only and are never written to disk by the tool.

| Variable | Provider |
| --- | --- |
| `ANTHROPIC_API_KEY` | `anthropic:` |
| `OPENAI_API_KEY` | `openai:` |
| `GOOGLE_API_KEY` | `google-genai:` |
| `OPENROUTER_API_KEY` | `openrouter:` |
| `XAI_API_KEY` | `xai:` |
| `MISTRAL_API_KEY` | `mistralai:` |
| `GROQ_API_KEY` | `groq:` |
| `OLLAMA_BASE_URL` | `ollama:` (local, no key) |

Avoid plaintext key files. Recommended ways to inject keys:

- **dotenvx**: `dotenvx run -- agent-evaluator serve` with an encrypted `.env` (private key stays outside the repo)
- **1Password CLI**: `op run --env-file=.env.tpl -- agent-evaluator serve` where `.env.tpl` holds `op://` references
- **direnv + sops**: decrypt on `cd`, never on disk in clear text
- **CI secrets**: GitHub Actions `secrets.*` mapped to the variables above

A plain `.env` works for local experiments; it is git-ignored. `.env.example` lists variable names only.

## Project structure

```
src/
  schemas/      zod schemas shared by server, agents and UI
  workspace/    workspace files and run artifact store
  config/       settings, secrets provider, model factory
  browser/      Playwright session (accessibility refs, screenshots, downloads)
  agents/       simulator and judge agents (LangChain createAgent)
  runner/       LangGraph orchestration and run events
  report/       HTML / JSON / JUnit report rendering
  server/       Hono REST + SSE API, serves the UI
  cli/          agent-evaluator CLI
  testing/      ScriptedChatModel and FakeBrowserSession test doubles
ui/             Vite + React configuration and run UI
fixtures/       demo chatbot used by the end-to-end tests
templates/      workspace file templates
docs/           architecture, decisions (ADRs) and phase plans
```

## Development

### Setup

```bash
npm ci
npx playwright install chromium
```

### Running tests

```bash
npm test               # unit + ui
npm run test:coverage
npm run test:e2e       # full pipeline against the demo chatbot
```

### Code quality and validation

```bash
npm run verify         # lint + typecheck + tests + build
```

Development follows TDD (red → green → refactor) with one commit per phase. Read
[`docs/plans/README.md`](./docs/plans/README.md) before contributing.

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).

## Contributing

1. Create a feature branch (`git checkout -b feat/my-change`).
2. Add or update tests for behaviour changes.
3. Run `npm run verify`.
4. Use Conventional Commits (`feat(judge): add latency criterion`).
5. Add a changelog fragment under `changelog.d/`.

## License

Licensed under the [Apache License 2.0](./LICENSE). Copyright 2026 numikel.

## Author

**[@numikel](https://github.com/numikel)**
