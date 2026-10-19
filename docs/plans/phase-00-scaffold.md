# Phase 0 — Scaffold, contracts, test doubles, templates, plans

Status: **done** (this commit). Listed for completeness.

Delivered: package.json with all dependencies, TypeScript 7 strict ESM config (`src/` + `ui/`), Biome,
Vitest projects (`unit`, `ui`, `e2e`), tsdown + Vite build (`dist/cli.js` bin, `dist/ui`), CI workflow,
Apache-2.0 LICENSE/NOTICE, README skeleton, CHANGELOG + `changelog.d/`, CLAUDE.md, SECURITY.md,
`.env.example`, `src/schemas/*` (+21 tests), frozen contracts in `src/{browser,workspace,config,runner}/types.ts`,
`src/testing/{scripted-chat-model,fake-browser-session}.ts` (+ smoke test proving `createAgent` tool loop and
`responseFormat` with the scripted model), `templates/*` (+ validation tests), UI placeholder, `docs/`.

Verification: `npm run verify` green on Node 22.22 (35 tests).
