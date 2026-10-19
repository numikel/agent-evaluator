# Phase 11 — CLI

Depends on: P8 P10 (Wave 3 `[PARALLEL]`). Commit: `feat(cli): init, serve, run, validate, report, templates and doctor commands`

## Goal
`agent-evaluator` CLI for developers and CI: scaffold a workspace, start the server, run scenarios headless,
validate files, re-render reports, export templates, and diagnose the environment.

## Read first
`src/cli/main.ts` (placeholder), `src/index.ts` (public API after P10), `src/config/doctor.ts`, commander 15 docs.

## Deliverables (`src/cli/commands/*.ts`, wired in `main.ts`)
- `init [dir] [--force]` → `workspace.init`; prints created files; exit 0.
- `serve [--port] [--host] [--workspace] [--open]` → builds deps (`EnvSecretsProvider`, registry, model factory, Playwright factory, runner), `startServer`; prints URL.
- `run <scenario...> [--target] [--repeat N] [--headed] [--json] [--fail-on-error]` → starts runs, streams progress to stderr (turn k/N, step action, criterion results), prints a summary table to stdout (scenario, status, score %, turns, report path); `--json` prints `summary.json` array; exit code 1 if any run FAILED/ERROR.
- `validate [--workspace]` → validates every file + cross-references via `workspace.resolve` for each scenario; prints issues; exit 1 on any.
- `report <runId> [--open]` → re-renders `report.html` from artifacts (useful after template/report changes).
- `templates [--out dir]` → writes all templates (or prints one with `--kind`).
- `doctor` → `runDoctor` table with ✓/✗ and fix hints; exit 1 if a check for a configured role's provider fails or Chromium is missing.
- `src/cli/output.ts` — tiny table/colour helpers (no new deps; respect `NO_COLOR`).
- `changelog.d/phase-11-cli.md`.

## Seams & TDD slices (invoke `buildCli()` with injected deps; capture stdout/stderr)
1. `init` in a temp dir creates the layout; second call is a no-op unless `--force`.
2. `validate` exit code 1 and lists `scenarios/bad.yaml: max_turns …` for an invalid file.
3. `run` with a fake runner emitting events prints progress lines and a summary; exit 1 when a run FAILED; `--json` output parses and matches `summary.json` schema.
4. `doctor` output includes the fix hint when Chromium is missing (injected `exists`).
5. `templates --out` writes six files.
6. `node dist/cli.js --help` lists all commands (run after `npm run build`).

## Commands
`npm test -- src/cli` · `npm run build && node dist/cli.js --help` · `npm run verify`

## Definition of done
- [ ] Seams 1–6 green; `npx agent-evaluator` works from a packed tarball (`npm pack` + install into a temp dir, smoke `init` + `doctor`).
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
