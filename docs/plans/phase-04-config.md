# Phase 4 — Config, secrets and model factory

Depends on: P0. Wave 1 `[PARALLEL]`. Commit: `feat(config): settings resolution, env secrets, provider registry and model factory`

## Goal
Implement `SecretsProvider`, `ProviderRegistry`, `ModelFactory` and doctor checks (`src/config/types.ts`)
so agents get a configured chat model from a `provider:model` reference, with keys from the environment only.

## Read first
`src/config/types.ts`, `src/schemas/settings.ts`, `docs/decisions/ADR-0002-secrets.md`, `README.md` ("Secrets"),
`node_modules/langchain/dist/chat_models/universal.d.ts` (`initChatModel` options), `node_modules/@langchain/openrouter`.

## Deliverables
- `src/config/secrets.ts` — `EnvSecretsProvider` (reads `process.env`; also loads a plain `.env` from the workspace root via `process.loadEnvFile` **only if present**, never writes).
- `src/config/providers.ts` — registry table (`ProviderDefinition` incl. `modelsEndpoint` and `effortKnob`): `anthropic/ANTHROPIC_API_KEY/@langchain/anthropic`, `openai/OPENAI_API_KEY`, `google-genai/GOOGLE_API_KEY`, `openrouter/OPENROUTER_API_KEY`, `xai/XAI_API_KEY`, `mistralai/MISTRAL_API_KEY`, `groq/GROQ_API_KEY`, `ollama/OLLAMA_BASE_URL` (configured when set or when default `http://localhost:11434` is reachable — keep it simple: set = configured). `parseRef` splits on the first `:` and rejects bare names with the same message as the schema. `configured(secrets)` returns only providers whose env var is set — **the UI must never offer others**.
  `listModels(providerId, secrets, { refresh?, fetch? })` calls the provider's listing endpoint with the key from `secrets`, maps to `ModelInfo` (`ref = provider:id`), caches 10 min in memory, and falls back to `examples` with `source: "fallback"` + `error` on any failure (never throws, never logs the key). Endpoints to verify at implementation time (write the test against recorded JSON fixtures, not the network):
  | provider | endpoint | auth | useful fields |
  | --- | --- | --- | --- |
  | openai | `GET https://api.openai.com/v1/models` | `Authorization: Bearer` | `data[].id` |
  | anthropic | `GET https://api.anthropic.com/v1/models` | `x-api-key` + `anthropic-version` | `data[].id`, `display_name` |
  | google-genai | `GET https://generativelanguage.googleapis.com/v1beta/models?key=` | query key | `models[].name` (strip `models/`), `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods` |
  | openrouter | `GET https://openrouter.ai/api/v1/models` | optional Bearer | `data[].id`, `name`, `context_length`, `top_provider.max_completion_tokens`, `supported_parameters` (contains `reasoning`), `architecture.input_modalities` |
  | xai | `GET https://api.x.ai/v1/language-models` (fallback `/v1/models`) | Bearer | `models[].id`, `input_modalities` |
  | mistralai | `GET https://api.mistral.ai/v1/models` | Bearer | `data[].id`, `max_context_length`, `capabilities` |
  | groq | `GET https://api.groq.com/openai/v1/models` | Bearer | `data[].id`, `context_window` |
  | ollama | `GET $OLLAMA_BASE_URL/api/tags` | none | `models[].name` |
- `src/config/models.ts` — `LangChainModelFactory`: `openrouter:` → `new ChatOpenRouter({ model, apiKey, temperature?, modelKwargs })`; everything else → `initChatModel(model, { modelProvider: provider, temperature?, ...extra })`. Omit `temperature` when undefined. Throws `ProviderNotConfiguredError` (names the env var) before calling the provider.
  **Effort mapping** (`src/config/effort.ts`, pure function `effortParams(knob, effort) → Record<string, unknown>`; LangChain has no unified knob — verified in the installed `.d.ts` on 2026-10-19):
  | knob | none | low | medium | high | max |
  | --- | --- | --- | --- | --- | --- |
  | openai (`reasoningEffort`; also xai) | omit | `low` | `medium` | `high` | `high` |
  | anthropic (`thinking: { type: "enabled", budget_tokens }`) | omit | 2048 | 8192 | 16384 | 32000 |
  | google (`thinkingConfig: { thinkingBudget }`) | 0 | 2048 | 8192 | 16384 | 24576 |
  | groq (`reasoningEffort`) | `none` | `low` | `medium` | `high` | `high` |
  | ollama (`think`) | false | true | true | true | true |
  | openrouter (`modelKwargs.reasoning = { effort }`) | omit | `low` | `medium` | `high` | `high` |
  | none (mistralai) | ignored | | | | |
  When the resulting model exposes a `profile` with `maxOutputTokens`, pass it as `maxTokens` unless the caller set one ("context always maximal": never trim input, never cap output below the model's limit).
- `src/config/settings.ts` — `resolveSettings({ file?, env, cli? })`: precedence file < env (`AE_PORT`, `AE_RUNS_DIR`, `AE_HEADLESS`, `AE_MODEL_SIMULATOR`, `AE_MODEL_JUDGE`) < CLI overrides; returns `Settings`.
- `src/config/doctor.ts` — `runDoctor({ secrets, settings, workspaceRoot })` → `DoctorCheck[]`: each provider's presence; Chromium installed (check `playwright`'s `chromium.executablePath()` exists); workspace files present; models in settings point to configured providers. Fix hints (`npx playwright install chromium`, `export ANTHROPIC_API_KEY=…`).
- `src/config/index.ts`; `changelog.d/phase-04-config.md`.

## Seams & TDD slices
1. `parseRef("anthropic:claude-sonnet-5-5")` → `{provider, model}`; `parseRef("gpt-5")` throws.
2. Registry `status()` with a fake `SecretsProvider` returns `configured` flags and never includes values.
3. `fromRef("openrouter:x/y")` without `OPENROUTER_API_KEY` throws `ProviderNotConfiguredError` mentioning the var; with the key returns an instance whose `_llmType()`/constructor name is OpenRouter (do not call the network).
4. `fromRef("anthropic:…")` with key set returns a model; `temperature` undefined is not passed (spy on `initChatModel` via dependency injection — accept an `init` function in the factory constructor).
5. `resolveSettings` precedence (file < env < cli); invalid env value → `ValidationError`.
5b. `effortParams` table above is unit-tested exhaustively; `forRole("judge", settings)` with `effort.judge = "high"` passes `thinking.budget_tokens = 16384` to the injected `init` for anthropic and `reasoningEffort: "high"` for openai.
5c. `listModels` with an injected `fetch` returning recorded JSON for each provider maps `ModelInfo` correctly (context window, images, reasoning flags); a 401 or network error yields `source: "fallback"` with `examples`; the cache serves the second call without fetching; `refresh: true` refetches. `configured()` excludes providers without env vars.
6. Doctor: all checks `ok:false` with fix hints in an empty env; Chromium check uses an injected `exists` function.
No live provider calls in tests.

## Commands
`npm test -- src/config` · `npm run verify`

## Definition of done
- [ ] Seams 1–6 green; no network in tests; no secrets logged (grep tests assert the key value never appears in error messages).
- [ ] No new dependencies. Changelog fragment. `npm run verify` green.
