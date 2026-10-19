### Added
- `src/config`: `EnvSecretsProvider` (environment only; loads an existing workspace `.env` via `process.loadEnvFile`, never writes) and `StaticSecretsProvider` for tests.
- Provider registry (`createProviderRegistry`, `PROVIDERS`, `parseRef`) for anthropic, openai, google-genai, openrouter, xai, mistralai, groq and ollama: presence-only status, `configured()` limited to providers whose env var is set, and live model listing from each provider API mapped to `ModelInfo` (10-minute in-memory cache, `examples` fallback with `source: "fallback"` and a redacted `error`, never throws).
- `LangChainModelFactory` (`forRole` / `fromRef`): `openrouter:` builds `ChatOpenRouter` directly, every other provider goes through `initChatModel`; `effortParams` maps the unified `effort` level onto each provider's reasoning knob; output tokens default to the model profile's `maxOutputTokens`; `ProviderNotConfiguredError` names the missing env var before any provider call.
- `resolveSettings` with precedence file < environment (`AE_PORT`, `AE_RUNS_DIR`, `AE_HEADLESS`, `AE_MODEL_SIMULATOR`, `AE_MODEL_JUDGE`) < CLI overrides, validated by `SettingsSchema`.
- `runDoctor` checks: provider keys, Chromium executable, workspace layout and whether each configured model points at a configured provider, with fix hints.

### Changed
- `ProviderDefinition.effortKnob` gains the `openrouter` value and `ProviderNotConfiguredError` is exported from `src/config/types.ts` (additive).
