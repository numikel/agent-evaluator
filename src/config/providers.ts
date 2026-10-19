import {
	MODEL_REF_PATTERN,
	type ModelInfo,
	ModelInfoSchema,
	type ProviderStatus,
	ValidationError,
} from "../schemas/index.js";
import type {
	ListModelsOptions,
	ProviderDefinition,
	ProviderRegistry,
	SecretsProvider,
} from "./types.js";

/** Sent to the Anthropic models endpoint; any released version works for `GET /v1/models`. */
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

/** Registry table. `examples` are shown when the listing endpoint is unavailable. */
export const PROVIDERS: readonly ProviderDefinition[] = [
	{
		id: "anthropic",
		label: "Anthropic",
		env: "ANTHROPIC_API_KEY",
		package: "@langchain/anthropic",
		examples: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
		modelsEndpoint: "https://api.anthropic.com/v1/models",
		effortKnob: "anthropic",
	},
	{
		id: "openai",
		label: "OpenAI",
		env: "OPENAI_API_KEY",
		package: "@langchain/openai",
		examples: ["gpt-5", "gpt-5-mini"],
		modelsEndpoint: "https://api.openai.com/v1/models",
		effortKnob: "openai",
	},
	{
		id: "google-genai",
		label: "Google Gemini",
		env: "GOOGLE_API_KEY",
		package: "@langchain/google-genai",
		examples: ["gemini-2.5-pro", "gemini-2.5-flash"],
		modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
		effortKnob: "google",
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		env: "OPENROUTER_API_KEY",
		package: "@langchain/openrouter",
		examples: ["anthropic/claude-sonnet-5.5", "openai/gpt-5", "google/gemini-2.5-pro"],
		modelsEndpoint: "https://openrouter.ai/api/v1/models",
		effortKnob: "openrouter",
	},
	{
		id: "xai",
		label: "xAI",
		env: "XAI_API_KEY",
		package: "@langchain/xai",
		examples: ["grok-4", "grok-3-mini"],
		modelsEndpoint: "https://api.x.ai/v1/language-models",
		effortKnob: "openai",
	},
	{
		id: "mistralai",
		label: "Mistral AI",
		env: "MISTRAL_API_KEY",
		package: "@langchain/mistralai",
		examples: ["mistral-large-latest", "mistral-medium-latest", "pixtral-large-latest"],
		modelsEndpoint: "https://api.mistral.ai/v1/models",
		effortKnob: "none",
	},
	{
		id: "groq",
		label: "Groq",
		env: "GROQ_API_KEY",
		package: "@langchain/groq",
		examples: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
		modelsEndpoint: "https://api.groq.com/openai/v1/models",
		effortKnob: "groq",
	},
	{
		id: "ollama",
		label: "Ollama (local)",
		env: "OLLAMA_BASE_URL",
		package: "@langchain/ollama",
		examples: ["llama3.2", "qwen3:8b"],
		modelsEndpoint: `${DEFAULT_OLLAMA_BASE_URL}/api/tags`,
		effortKnob: "ollama",
	},
];

export class UnknownProviderError extends Error {
	override readonly name = "UnknownProviderError";
	constructor(readonly provider: string) {
		super(
			`unknown provider '${provider}'; supported providers: ${PROVIDERS.map((p) => p.id).join(", ")}`,
		);
	}
}

const REF_MESSAGE = "must be an explicit 'provider:model' reference";

/** Splits `provider:model` on the first colon. Bare names are rejected with the schema's message. */
export function parseRef(ref: string): { provider: string; model: string } {
	if (!MODEL_REF_PATTERN.test(ref)) {
		throw new ValidationError(undefined, [{ path: "", message: REF_MESSAGE }]);
	}
	const colon = ref.indexOf(":");
	return { provider: ref.slice(0, colon), model: ref.slice(colon + 1) };
}

// ---------------------------------------------------------------------------------------------
// Listing endpoints. Each spec maps a provider's documented response body onto `ModelInfo`.
// ---------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
/** Mapper output: every `ModelInfo` field optional and explicitly allowed to be undefined. */
type Mapped = { [K in keyof ModelInfo]?: ModelInfo[K] | undefined };
type ListingSpec = {
	/** Candidate URLs tried in order (the first that answers 2xx with parsable JSON wins). */
	urls: (credential: string) => string[];
	headers: (credential: string) => Record<string, string>;
	map: (body: unknown) => Mapped[];
};

const isObject = (v: unknown): v is Json =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const posInt = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
const strList = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
const list = (body: unknown, key: string): Json[] =>
	isObject(body) && Array.isArray(body[key]) ? body[key].filter(isObject) : [];
const bearer = (credential: string) => ({ authorization: `Bearer ${credential}` });

/** OpenAI-compatible `{ data: [{ id }] }` body. */
const mapOpenAiList = (body: unknown): Mapped[] =>
	list(body, "data").map((m) => ({ id: str(m.id) }));

const LISTINGS: Record<string, ListingSpec> = {
	openai: {
		urls: () => ["https://api.openai.com/v1/models"],
		headers: bearer,
		map: mapOpenAiList,
	},
	anthropic: {
		urls: () => ["https://api.anthropic.com/v1/models"],
		headers: (credential) => ({
			"x-api-key": credential,
			"anthropic-version": ANTHROPIC_API_VERSION,
		}),
		map: (body) => list(body, "data").map((m) => ({ id: str(m.id), label: str(m.display_name) })),
	},
	"google-genai": {
		urls: (credential) => [
			`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(credential)}`,
		],
		headers: () => ({}),
		map: (body) =>
			list(body, "models")
				.filter((m) => strList(m.supportedGenerationMethods).includes("generateContent"))
				.map((m) => ({
					id: str(m.name)?.replace(/^models\//, ""),
					label: str(m.displayName),
					context_window: posInt(m.inputTokenLimit),
					max_output_tokens: posInt(m.outputTokenLimit),
					// `thinking` is not part of the documented schema; treated as a hint only.
					supports_reasoning: m.thinking === true ? true : undefined,
				})),
	},
	openrouter: {
		urls: () => ["https://openrouter.ai/api/v1/models"],
		headers: bearer,
		map: (body) =>
			list(body, "data").map((m) => {
				const params = strList(m.supported_parameters);
				const architecture = isObject(m.architecture) ? m.architecture : {};
				const top = isObject(m.top_provider) ? m.top_provider : {};
				return {
					id: str(m.id),
					label: str(m.name),
					context_window: posInt(m.context_length),
					max_output_tokens: posInt(top.max_completion_tokens),
					supports_reasoning: params.includes("reasoning"),
					supports_images: strList(architecture.input_modalities).includes("image"),
					supports_tools: params.includes("tools"),
				};
			}),
	},
	xai: {
		urls: () => ["https://api.x.ai/v1/language-models", "https://api.x.ai/v1/models"],
		headers: bearer,
		map: (body) =>
			isObject(body) && Array.isArray(body.models)
				? list(body, "models").map((m) => ({
						id: str(m.id),
						supports_images: Array.isArray(m.input_modalities)
							? strList(m.input_modalities).includes("image")
							: undefined,
					}))
				: mapOpenAiList(body),
	},
	mistralai: {
		urls: () => ["https://api.mistral.ai/v1/models"],
		headers: bearer,
		map: (body) =>
			list(body, "data")
				.filter((m) => !isObject(m.capabilities) || m.capabilities.completion_chat !== false)
				.map((m) => {
					const caps = isObject(m.capabilities) ? m.capabilities : {};
					return {
						id: str(m.id),
						label: str(m.name),
						context_window: posInt(m.max_context_length),
						supports_images: typeof caps.vision === "boolean" ? caps.vision : undefined,
						supports_tools:
							typeof caps.function_calling === "boolean" ? caps.function_calling : undefined,
					};
				}),
	},
	groq: {
		urls: () => ["https://api.groq.com/openai/v1/models"],
		headers: bearer,
		map: (body) =>
			list(body, "data").map((m) => ({
				id: str(m.id),
				context_window: posInt(m.context_window),
				max_output_tokens: posInt(m.max_completion_tokens),
			})),
	},
	ollama: {
		urls: (baseUrl) => [`${baseUrl.replace(/\/+$/, "")}/api/tags`],
		headers: () => ({}),
		map: (body) => list(body, "models").map((m) => ({ id: str(m.name) ?? str(m.model) })),
	},
};

/** Builds a validated `ModelInfo` from a partial mapping; undefined fields are dropped. */
function toModelInfo(provider: string, partial: Mapped): ModelInfo | undefined {
	if (!partial.id) return undefined;
	const candidate: Record<string, unknown> = {
		provider,
		id: partial.id,
		label: partial.label ?? partial.id,
		ref: `${provider}:${partial.id}`,
	};
	for (const key of [
		"context_window",
		"max_output_tokens",
		"supports_reasoning",
		"supports_images",
		"supports_tools",
	] as const) {
		if (partial[key] !== undefined) candidate[key] = partial[key];
	}
	const parsed = ModelInfoSchema.safeParse(candidate);
	return parsed.success ? parsed.data : undefined;
}

const fallbackModels = (def: ProviderDefinition): ModelInfo[] =>
	def.examples.map((id) => ({ provider: def.id, id, label: id, ref: `${def.id}:${id}` }));

/** Replaces every occurrence of the credential in a message; keys never reach logs or the UI. */
function redact(message: string, credential: string | undefined): string {
	if (!credential || credential.length < 4) return message;
	return message.split(credential).join("***");
}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

async function fetchListing(
	spec: ListingSpec,
	credential: string,
	fetchFn: typeof fetch,
): Promise<Mapped[]> {
	const failures: string[] = [];
	for (const url of spec.urls(credential)) {
		const response = await fetchFn(url, { method: "GET", headers: spec.headers(credential) });
		if (!response.ok) {
			failures.push(
				`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
			);
			continue;
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			failures.push("invalid JSON response");
			continue;
		}
		return spec.map(body);
	}
	throw new Error(failures.join("; ") || "no listing endpoint answered");
}

export type ProviderRegistryOptions = {
	/** Clock for cache expiry (tests). */
	now?: () => number;
	cacheTtlMs?: number;
};

type CacheEntry = { expiresAt: number; models: ModelInfo[] };

/** Default registry: static provider table, presence-only status, cached live model listings. */
export function createProviderRegistry(options: ProviderRegistryOptions = {}): ProviderRegistry {
	const now = options.now ?? Date.now;
	const ttl = options.cacheTtlMs ?? MODELS_CACHE_TTL_MS;
	const cache = new Map<string, CacheEntry>();
	const byId = new Map(PROVIDERS.map((p) => [p.id, p]));

	return {
		all: () => [...PROVIDERS],

		status: (secrets: SecretsProvider): ProviderStatus[] =>
			PROVIDERS.map((p) => ({
				id: p.id,
				label: p.label,
				env: p.env,
				configured: secrets.has(p.env),
			})),

		configured: (secrets: SecretsProvider) => PROVIDERS.filter((p) => secrets.has(p.env)),

		parseRef(ref) {
			const parsed = parseRef(ref);
			if (!byId.has(parsed.provider)) throw new UnknownProviderError(parsed.provider);
			return parsed;
		},

		async listModels(providerId, secrets, listOptions: ListModelsOptions = {}) {
			const def = byId.get(providerId);
			if (!def) {
				return { models: [], source: "fallback", error: `unknown provider '${providerId}'` };
			}
			const credential = secrets.get(def.env);
			if (credential === undefined) {
				return {
					models: fallbackModels(def),
					source: "fallback",
					error: `${def.env} is not set`,
				};
			}
			const cached = cache.get(providerId);
			if (!listOptions.refresh && cached && cached.expiresAt > now()) {
				return { models: cached.models, source: "api" };
			}
			const spec = LISTINGS[providerId];
			if (!spec) {
				return { models: fallbackModels(def), source: "fallback", error: "no listing endpoint" };
			}
			try {
				const partials = await fetchListing(spec, credential, listOptions.fetch ?? fetch);
				const models = partials
					.map((p) => toModelInfo(def.id, p))
					.filter((m): m is ModelInfo => m !== undefined);
				cache.set(providerId, { expiresAt: now() + ttl, models });
				return { models, source: "api" };
			} catch (error) {
				return {
					models: fallbackModels(def),
					source: "fallback",
					error: redact(errorMessage(error), credential),
				};
			}
		},
	};
}
