# Phase 8 — Server API (Hono)

Depends on: P0 only (programs against `Workspace`, `RunStore`, `Runner`, `ProviderRegistry` contracts with in-memory fakes in tests). Wave 1 `[PARALLEL]`.
Commit: `feat(server): Hono REST API, SSE run events and static UI serving`

## Goal
`createServer(deps)` returns a Hono app exposing the routes documented in `src/schemas/api.ts`, streaming
`RunEvent`s over SSE, serving run artifacts and the built SPA.

## Read first
`src/schemas/api.ts` (route list + DTOs — the contract), `src/{workspace,runner,config}/types.ts`, Hono docs for
`streamSSE` (`hono/streaming`) and `serveStatic` from `@hono/node-server/serve-static` (root is cwd-relative — resolve
`dist/ui` via `fileURLToPath(import.meta.url)`), `zod` validation via `@hono/zod-validator`? **Not installed** — validate
manually with `parseWith` and return 422 `ValidationErrorBody`.

## Deliverables
- `src/server/app.ts` — `createApp({ workspace, runStore, runner, providers, secrets, settingsLoader, uiDir? })`.
  Routes under `/api` exactly as listed in `api.ts`; JSON errors `{ error, message }` with proper status (404 unknown resource, 422 validation, 409 run not cancellable, 500 fallback with no stack in body).
  - `GET /providers` → `providers.status(secrets).filter(configured)`; `GET /providers/:id/models?refresh=1` → `ProviderModelsResponse` (404 for unknown or unconfigured provider).
  - `GET /settings` → `{ settings, providers (all, with configured flags), browser_installed }`; `PUT /settings` validates `SettingsSchema` and writes via `workspace.writeRaw("settings", yaml)`.
  - `GET /runs/:id/events` → SSE: replays `events.jsonl` first (so late joiners see history), then live events from `runner.subscribe`; heartbeat comment every 15 s; closes on `done`/`error fatal`.
  - `GET /runs/:id/artifacts/*` → `runStore.artifactPath` (traversal rejected → 400) with content-type by extension; `GET /runs/:id/report` → `report.html`.
  - `GET /templates/:kind` → `text/plain` + `Content-Disposition: attachment`.
  - Static UI: everything not under `/api` serves `dist/ui`, SPA fallback to `index.html`; 404 JSON only for `/api/*`.
- `src/server/start.ts` — `startServer({ app, host, port })` via `@hono/node-server`, logs the URL (pino), graceful shutdown on SIGINT.
- `src/server/testing.ts` — in-memory `Workspace`/`RunStore`/`Runner`/`ProviderRegistry` fakes for tests (export for P11/P13 reuse).
- `src/server/index.ts`; `changelog.d/phase-08-server.md`.

## Seams & TDD slices (use `app.request()`; no sockets)
1. `GET /api/health` → 200 `{ ok: true, version }`.
2. `GET /api/personas` lists; `PUT /api/personas/x` with invalid frontmatter → 422 with `issues[]`; valid → 204 and workspace fake records the write.
3. `POST /api/validate` returns `{ok:false, issues}` for a scenario with `max_turns: 0`.
4. `GET /api/providers` returns only configured providers; `GET /api/providers/openai/models` proxies the registry (fallback flagged); unknown provider → 404.
5. `POST /api/runs` validates `StartRunRequest`, calls `runner.start`, returns `{ runIds }`; `RunPreconditionError` → 422.
6. SSE: `GET /api/runs/r1/events` body contains replayed `data:` lines for stored events followed by a live one emitted through the fake runner; `Content-Type: text/event-stream`.
7. Artifacts: `../` path → 400; `.png` → `image/png`.
8. Static: `/` returns `index.html` content when `uiDir` is a temp dir with an index; `/some/route` falls back to it; `/api/nope` → JSON 404.

## Commands
`npm test -- src/server` · `npm run verify`

## Definition of done
- [ ] Seams 1–8 green; no secrets in any response (test greps for the fake key value).
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
