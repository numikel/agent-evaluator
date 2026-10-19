### Added
- Hono server (`src/server`): `createApp(deps)` exposing every `/api` route from `src/schemas/api.ts` — workspace overview and resource CRUD (personas, scenarios, rubrics, targets, evaluator, settings), `POST /api/validate`, template downloads, provider presence and live model listing (configured providers only, secret values redacted), run start/list/detail/cancel, run artifacts and `report.html`.
- `GET /api/runs/:id/events`: Server-Sent Events that replay `events.jsonl` history, then stream live `RunEvent`s with periodic heartbeat comments and close on `done` or a fatal `error`.
- Static SPA serving from `dist/ui` with SPA fallback to `index.html`; JSON `404` bodies only under `/api`.
- `startServer({ app, host, port })` on `@hono/node-server` with pino logging and graceful SIGINT/SIGTERM shutdown.
- In-memory test doubles for the P0 contracts (`src/server/testing.ts`): `InMemoryWorkspace`, `InMemoryRunStore`, `FakeRunner` (with `emit`), `FakeProviderRegistry`, `FakeSecrets` and `createFakeDeps()`.
