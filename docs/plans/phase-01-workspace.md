# Phase 1 — Workspace & RunStore

Depends on: P0. Wave 1 `[PARALLEL]`. Commit: `feat(workspace): load, validate and store workspace files and run artifacts`

## Goal
Implement `Workspace` and `RunStore` (`src/workspace/types.ts`) on the filesystem so every other module can
read persona/scenario/rubric/target/evaluator/settings files and persist run evidence.

## Read first
`docs/plans/README.md`, `src/workspace/types.ts`, `src/schemas/*`, `templates/*`, `templates/templates.test.ts`
(contains the frontmatter splitter to reuse), `docs/architecture.md` (evidence layout).

## Deliverables
- `src/workspace/frontmatter.ts` — `splitFrontmatter(md)` / `joinFrontmatter(fm, body)` using `yaml` (no gray-matter).
- `src/workspace/files.ts` — `FsWorkspace implements Workspace`: `init` (mkdir + copy templates for missing files, returns created paths), `list`, `load*` (parse YAML/Markdown → `parseOrThrow(schema, data, relativePath)`), `readRaw`/`writeRaw`/`validateRaw`/`remove`, `resolve` (loads scenario → persona, target (override allowed), rubric (scenario.rubric ?? evaluator.default_rubric; error if neither), evaluator, settings; applies `withBuiltinCriteria`), `template(kind)` (reads from `templates/` resolved via `import.meta.url`, works from `dist/` too — templates are shipped in the npm package).
- `src/workspace/run-store.ts` — `FsRunStore implements RunStore`: run dirs `runs/<id>`, `run.json` atomic writes (write temp + rename), `steps/NNN/…` zero-padded to 3, JSONL appenders, `downloads/` + `downloads.json`, `artifactPath` rejects `..`/absolute paths (throws), `list()` sorted by `started_at` desc.
- `src/workspace/index.ts` — `openWorkspace(root)`, `openRunStore(root)`, re-export types.
- `changelog.d/phase-01-workspace.md`.

## Seams & TDD slices (write the test first for each)
1. `splitFrontmatter` round-trips the PERSONA template and rejects a file without frontmatter (clear error naming the file).
2. `FsWorkspace.init` on an empty temp dir creates dirs + copies templates; second call creates nothing.
3. `loadScenario` returns parsed defaults; a YAML with `max_turns: 0` throws `ValidationError` whose message contains `scenarios/<name>.yaml`.
4. `resolve` wires persona/target/rubric/evaluator/settings; missing persona → error "persona 'x' referenced by scenario 'y' not found"; rubric fallback to `default_rubric`; target override.
5. `writeRaw` validates before writing (invalid content leaves the old file untouched).
6. `FsRunStore`: create → saveScreenshot (bytes written, relative path returned) → saveStep → appendTranscript → readTranscript; `artifactPath("../x")` throws; `updateRecord` merges and persists; `list` ordering.
7. `saveDownload` moves a file and records bytes/mime.
Use `node:fs/promises` + `os.tmpdir()`; clean up in `afterEach`.

## Commands
`npm test -- src/workspace` · `npm run verify`

## Definition of done
- [ ] All seams above tested; coverage of `src/workspace` ≥ 85 %.
- [ ] `init` works when invoked from the built package (`node dist/cli.js` path resolution of templates verified by a test that imports from `src` but resolves `templates/` relative to the package root).
- [ ] No new dependencies. Changelog fragment added. `npm run verify` green.
