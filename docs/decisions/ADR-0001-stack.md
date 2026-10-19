# ADR-0001: Stack — LangChain v1 `createAgent` + LangGraph, Playwright a11y refs, Hono + React, single package

Date: 2026-10-19 · Status: accepted

## Context

The tool needs two LLM agents (browser-driving simulator, judge), multi-provider model access, a local
server with a visual configuration UI, and a browser driver that works with any text model.

## Decision

- **Agents:** `langchain@1.5` `createAgent` (middleware, `responseFormat`, `toolCallLimitMiddleware`), models via
  `initChatModel("provider:model")`; `@langchain/openrouter` instantiated directly because it is not in
  `initChatModel`'s provider map. Run orchestration as a LangGraph `StateGraph` streamed to SSE.
- **Browser:** Playwright `page.ariaSnapshot({ mode: "ai" })` + `page.getByRef()` wrapped in our own tool set.
  Screenshots after every step as evidence; optional vision mode.
- **Server/UI:** Hono (`@hono/node-server`) serving a Vite + React SPA from `dist/ui`; SSE for live events.
- **Storage:** filesystem (`runs/<id>/…`) is the source of truth; no database in v0.1.
- **Layout:** single npm package, strict module boundaries via `*/types.ts` contracts.
- **Tooling:** npm, TypeScript strict ESM, Biome, Vitest 5, tsdown, Node ≥ 22.13.

## Alternatives rejected

- `deepagents` — peer dependency conflict (`langsmith <0.10` vs langchain's `>=0.11`); planning/filesystem tools unnecessary.
- `@playwright/mcp` as a dependency — pins an alpha Playwright build; the same snapshot mechanism is available in Playwright itself.
- Native Anthropic computer-use toolset — best quality but single-provider.
- `agent-browser` (Vercel Labs, Rust/CDP CLI) — attractive ref-based snapshots and annotated screenshots, but no programmatic download events and a separate binary. Kept as a possible second `BrowserSession` implementation; its annotated-screenshot idea is adopted for vision mode.
- Monorepo — more boilerplate for little gain at this size.
