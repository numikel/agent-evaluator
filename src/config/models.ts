import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Effort, ModelRole, Settings } from "../schemas/index.js";
import { effortParams } from "./effort.js";
import { createProviderRegistry } from "./providers.js";
import {
	type CreateModelOptions,
	type ModelFactory,
	type ProviderDefinition,
	ProviderNotConfiguredError,
	type ProviderRegistry,
	type SecretsProvider,
} from "./types.js";

/** Signature of `initChatModel` from `langchain/chat_models/universal` (injectable for tests). */
export type InitChatModelFn = (
	model: string,
	fields?: Record<string, unknown>,
) => Promise<BaseChatModel>;

/** Constructor shape of `ChatOpenRouter` (injectable for tests). */
export type OpenRouterCtor = new (fields: Record<string, unknown>) => BaseChatModel;

export type LangChainModelFactoryOptions = {
	secrets: SecretsProvider;
	registry?: ProviderRegistry;
	/** Defaults to the real `initChatModel`, imported lazily. */
	init?: InitChatModelFn;
	/** Defaults to the real `ChatOpenRouter`, imported lazily. */
	openRouter?: OpenRouterCtor | (() => Promise<OpenRouterCtor>);
};

/**
 * Constructor parameter that caps output tokens, per provider package (from the installed `.d.ts`).
 * Everything not listed uses `maxTokens`.
 */
const OUTPUT_LIMIT_PARAM: Record<string, string> = {
	"google-genai": "maxOutputTokens",
	ollama: "numPredict",
};

const defaultInit: InitChatModelFn = async (model, fields) => {
	const { initChatModel } = await import("langchain/chat_models/universal");
	return initChatModel(model, fields);
};

const defaultOpenRouter = async (): Promise<OpenRouterCtor> => {
	const { ChatOpenRouter } = await import("@langchain/openrouter");
	return ChatOpenRouter as unknown as OpenRouterCtor;
};

/** Reads `profile.maxOutputTokens` when the created model exposes a profile. */
function profileMaxOutputTokens(model: BaseChatModel): number | undefined {
	try {
		const max = (model as { profile?: { maxOutputTokens?: unknown } }).profile?.maxOutputTokens;
		return typeof max === "number" && Number.isInteger(max) && max > 0 ? max : undefined;
	} catch {
		return undefined;
	}
}

/** Re-throws provider errors with the credential removed from the message. */
function redactError(error: unknown, credential: string): never {
	if (error instanceof Error && error.message.includes(credential)) {
		const redacted = new Error(error.message.split(credential).join("***"));
		redacted.name = error.name;
		throw redacted;
	}
	throw error;
}

/**
 * Builds LangChain chat models from `provider:model` references. OpenRouter is constructed
 * directly (it is not in `initChatModel`'s provider map); every other provider goes through
 * `initChatModel` with an explicit `modelProvider`. Output tokens default to the model profile's
 * `maxOutputTokens` so responses are never truncated below the model's own limit.
 */
export class LangChainModelFactory implements ModelFactory {
	private readonly secrets: SecretsProvider;
	private readonly registry: ProviderRegistry;
	private readonly init: InitChatModelFn;
	private readonly openRouter: () => Promise<OpenRouterCtor>;

	constructor(options: LangChainModelFactoryOptions) {
		this.secrets = options.secrets;
		this.registry = options.registry ?? createProviderRegistry();
		this.init = options.init ?? defaultInit;
		const ctor = options.openRouter;
		this.openRouter =
			ctor === undefined ? defaultOpenRouter : isCtor(ctor) ? async () => ctor : ctor;
	}

	async forRole(
		role: ModelRole,
		settings: Settings,
		options: CreateModelOptions = {},
	): Promise<BaseChatModel> {
		// The evidence selector inherits the whole judge configuration when it has no model of its own.
		const effective: ModelRole =
			role === "evidence_selector" && settings.models.evidence_selector === undefined
				? "judge"
				: role;
		const ref = settings.models[effective];
		if (ref === undefined) throw new Error(`no model configured for role '${role}'`);
		const merged: CreateModelOptions = { ...options };
		const temperature = options.temperature ?? settings.temperature?.[effective];
		if (temperature !== undefined) merged.temperature = temperature;
		const effort: Effort | undefined = options.effort ?? settings.effort?.[effective];
		if (effort !== undefined) merged.effort = effort;
		return this.fromRef(ref, merged);
	}

	async fromRef(ref: string, options: CreateModelOptions = {}): Promise<BaseChatModel> {
		const { provider, model } = this.registry.parseRef(ref);
		const def = this.registry.all().find((p) => p.id === provider);
		if (!def) throw new Error(`unknown provider '${provider}'`);
		const credential = this.secrets.get(def.env);
		if (credential === undefined) throw new ProviderNotConfiguredError(provider, def.env);

		const params = this.baseParams(def, options);
		const limitKey = OUTPUT_LIMIT_PARAM[provider] ?? "maxTokens";
		if (options.maxTokens !== undefined) params[limitKey] = options.maxTokens;

		if (provider === "openrouter") {
			const Ctor = await this.openRouter();
			const fields = { model, apiKey: credential, ...params };
			const first = new Ctor(fields);
			const max = options.maxTokens === undefined ? profileMaxOutputTokens(first) : undefined;
			return max === undefined ? first : new Ctor({ ...fields, [limitKey]: max });
		}

		const fields: Record<string, unknown> = {
			modelProvider: provider,
			[provider === "ollama" ? "baseUrl" : "apiKey"]: credential,
			...params,
		};
		try {
			const first = await this.init(model, fields);
			const max = options.maxTokens === undefined ? profileMaxOutputTokens(first) : undefined;
			return max === undefined ? first : await this.init(model, { ...fields, [limitKey]: max });
		} catch (error) {
			return redactError(error, credential);
		}
	}

	private baseParams(
		def: ProviderDefinition,
		options: CreateModelOptions,
	): Record<string, unknown> {
		const params: Record<string, unknown> = {};
		if (options.temperature !== undefined) params.temperature = options.temperature;
		Object.assign(params, effortParams(def.effortKnob, options.effort), options.extra);
		return params;
	}
}

const isCtor = (value: OpenRouterCtor | (() => Promise<OpenRouterCtor>)): value is OpenRouterCtor =>
	typeof value === "function" && value.prototype !== undefined;
