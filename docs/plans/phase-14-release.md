# Phase 14 — Documentation and release 0.1.0

Depends on: all previous phases. Commits: `docs: complete README, architecture and changelog for 0.1.0` then `chore(release): 0.1.0`

## Deliverables
- README: replace the status banner; real screenshots in `docs/screenshots/` (UI settings cascade, live run, report); full CLI reference table; configuration reference for every file with field tables; "How it works" with the architecture diagram; troubleshooting (Chromium, keys, timeouts); roadmap.
- `CHANGELOG.md`: assemble `changelog.d/*` into `## [0.1.0] — <date>`; delete fragments.
- `docs/architecture.md` final pass; new ADRs if any contract changed during implementation.
- `CLAUDE.md` refresh (commands, structure), `SECURITY.md` check.
- `package.json`: verify `files`, `bin`, `exports`; `npm pack --dry-run` lists `dist/` and `templates/` only (+ README, LICENSE, NOTICE); `npm publish --dry-run`.
- Tag `v0.1.0` after merge; optional `release.yml` workflow publishing on tag (needs `NPM_TOKEN` secret — document, do not add the secret).

## Definition of done
- [ ] `npm run verify && npm run test:e2e` green; `npx agent-evaluator@file:./agent-evaluator-0.1.0.tgz init` works in an empty dir.
- [ ] README reviewed against the numikel README conventions (sections, tables, Author footer).
