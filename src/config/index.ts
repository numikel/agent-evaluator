/**
 * Config module (P4): settings resolution, environment secrets, provider registry, model factory
 * and doctor checks. Contracts live in `./types.ts`.
 */
export {
	CHROMIUM_INSTALL_HINT,
	type DoctorOptions,
	runDoctor,
	TARGET_PROBE_TIMEOUT_MS,
	type TargetProbe,
} from "./doctor.js";
export { type EffortKnob, effortParams } from "./effort.js";
export {
	type InitChatModelFn,
	LangChainModelFactory,
	type LangChainModelFactoryOptions,
	type OpenRouterCtor,
} from "./models.js";
export {
	ANTHROPIC_API_VERSION,
	createProviderRegistry,
	DEFAULT_OLLAMA_BASE_URL,
	MODELS_CACHE_TTL_MS,
	PROVIDERS,
	type ProviderRegistryOptions,
	parseRef,
	UnknownProviderError,
} from "./providers.js";
export {
	EnvSecretsProvider,
	type EnvSecretsProviderOptions,
	StaticSecretsProvider,
} from "./secrets.js";
export {
	type ResolveSettingsOptions,
	resolveSettings,
	SETTINGS_ENV_VARS,
	type SettingsOverrides,
} from "./settings.js";
export type * from "./types.js";
export { ProviderNotConfiguredError } from "./types.js";
