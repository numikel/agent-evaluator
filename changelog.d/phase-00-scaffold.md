### Added
- Project scaffold: TypeScript (strict, ESM), Biome, Vitest projects (`unit`, `ui`, `e2e`), tsdown build, Vite UI build, CI workflow (Node 24/26).
- Zod schemas for personas, scenarios, rubrics, targets, evaluator config, settings, run artifacts and REST DTOs (`src/schemas`).
- Frozen module contracts: `BrowserSession`, `Workspace`/`RunStore`, `SecretsProvider`/`ModelFactory`, `Runner`/`RunEvent`.
- Test doubles: `ScriptedChatModel` (works with `createAgent` tool loops and `responseFormat`) and `FakeBrowserSession`.
- Shipped templates (`templates/`) validated by tests.
- Phase plans and briefs under `docs/plans/`, architecture overview and ADRs.
