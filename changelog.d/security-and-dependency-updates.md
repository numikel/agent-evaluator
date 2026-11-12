### Security
- The HTML report escapes every value taken from the run data, including fields typed as numbers or enums (verdict status, turn counts, criterion weights, step and turn numbers, transcript role, console level) and the download MIME type. `renderHtml` is public API and `run.json` is plain data on disk, so crafted input could previously inject markup into `report.html` (CodeQL `js/html-constructed-from-input`). Output for valid runs is unchanged.
- Screenshot anchors in the report are built without the backtracking `^-+|-+$` pattern (CodeQL `js/polynomial-redos`). It was not exploitable here, because separator runs were collapsed first.
- `hono` 4.13.18 and `@hono/node-server` 2.1.8, now also the minimum versions in `package.json`. The server answers `400` to a raw backslash in the request path instead of routing `/api\health` as `/api/health` (GHSA-jpvv-r467-5p4w). The other advisories fixed in these releases concern features the app does not use (`mount()`, `validator()`, `csrf()`, `css`, `bodyLimit()`, `serveStatic()`, WebSocket upgrades).

### Changed
- LangChain: `@langchain/core` 1.3.2, `@langchain/anthropic` 1.6.0, `@langchain/openai` 1.7.0, `@langchain/xai` 1.5.0, `@langchain/google-genai` 2.3.4, `@langchain/langgraph` 1.5.2, `@langchain/openrouter` 0.4.19, `langchain` 1.5.19. Streamed tool-call arguments now travel as `tool-call-delta` slices; assembled messages and tool calls are unchanged.
- Development tooling: Biome 2.6 (configuration migrated; its new YAML formatter and linter stay off), Vitest 5.1, Vite 8.3.6, tsdown 0.23.5, jsdom 31, `@vitejs/plugin-react` 6.2.1, msw 3.0.4, react-router 8.5.1, `@types/node` 26.6.6.
- Dependabot no longer proposes `unpdf` 2.x, which requires Node.js ≥ 24 while this package supports Node.js ≥ 22.13.

### Added
- A wire-level contract test drives the real provider packages (Anthropic, OpenAI, OpenRouter, xAI) through `LangChainModelFactory` against a local fake API: tool calls from `invoke` and from sliced streams, structured output and a `createAgent` tool loop.
