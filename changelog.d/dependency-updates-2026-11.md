### Changed
- `temperature.<role>` is no longer sent to `anthropic:` models. `@langchain/anthropic` 1.6.2 moves to `@anthropic-ai/sdk` 1.x, which speaks Claude API version 2026-10-21; that version rejects `temperature`, `top_p` and `top_k` with a 400 on every model, so a configured temperature would have failed every run. Anthropic roles now sample at the model default (1.0); other providers still receive the value. The API key now travels as `Authorization: Bearer` instead of `X-Api-Key` (the API accepts both); a proxy or gateway in front of `api.anthropic.com` that reads only `X-Api-Key` needs updating.
- LangChain: `@langchain/anthropic` 1.6.2, `@langchain/core` 1.3.6, `@langchain/langgraph` 1.7.3, `@langchain/openai` 1.8.2, `@langchain/xai` 1.5.4, `@langchain/openrouter` 0.4.23, `@langchain/google-genai` 2.3.6, `langchain` 1.6.3.
- HTTP server: `hono` 4.13.19, `@hono/node-server` 2.1.9. CLI: `commander` 15.1.0.
- Development tooling: Biome 2.6.8, `@testing-library/jest-dom` 8, Vitest 5.1.1, Vite 8.3.8, `@vitejs/plugin-react` 6.3.0, tsdown 0.23.7, jsdom 31.0.1, msw 3.0.7, react-router 8.5.2. `dist/index.d.ts` now keeps the public API doc comment.

### Added
- Contract tests for the upgrades: the fake Claude API applies the real API's key and API-version checks; the UI round trip (JSON bodies, live SSE, disconnect) runs through the real Node adapter; the built package type-checks as a library consumer imports it; `--repeat` rejects zero, negative and fractional counts.
