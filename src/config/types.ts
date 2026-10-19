/**
 * FROZEN CONTRACT (P0). Secrets and model construction.
 * Implemented in P4; consumed by agents (P6, P7), server (P8), CLI (P11).
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Effort, ModelInfo, ModelRole, ProviderStatus, Settings } from "../schemas/index.js";

/** Read-only access to secrets. The default implementation reads `process.env`; values are never persisted. */
export interface SecretsProvider {
	get(name: string): string | undefined;
	has(name: string): boolean;
}

export type ProviderDefinition = {
	id: string;
	label: string;
	/** Env var holding the API key (or base URL for local providers). */
	env: string;
	/** npm package that must be installed for `initChatModel`. */
	package: string;
	/** Fallback model ids shown when the listing endpoint is unavailable. */
	examples: string[];
	/** Provider model-listing endpoint (GET); undefined when the provider has none. */
	modelsEndpoint?: string;
	/** Which reasoning-effort knob the provider exposes; `none` means effort is ignored. */
	effortKnob: "openai" | "anthropic" | "google" | "groq" | "ollama" | "none";
};

export type ListModelsOptions = {
	/** Bypass the in-memory cache (default TTL 10 minutes). */
	refresh?: boolean;
	fetch?: typeof fetch;
};

export interface ProviderRegistry {
	all(): ProviderDefinition[];
	status(secrets: SecretsProvider): ProviderStatus[];
	/** Providers whose env variable is set — the only ones the UI offers. */
	configured(secrets: SecretsProvider): ProviderDefinition[];
	/** Lists models from the provider API (needs its key); falls back to `examples` on failure. */
	listModels(
		providerId: string,
		secrets: SecretsProvider,
		options?: ListModelsOptions,
	): Promise<{ models: ModelInfo[]; source: "api" | "fallback"; error?: string }>;
	/** Parses `provider:model`; throws on bare model names. */
	parseRef(ref: string): { provider: string; model: string };
}

export type CreateModelOptions = {
	temperature?: number;
	/** Mapped per provider; see `ProviderDefinition.effortKnob`. */
	effort?: Effort;
	/**
	 * Output budget. Defaults to the model profile's `maxOutputTokens` when known so the model is
	 * never artificially truncated; context (input) is never trimmed by the tool.
	 */
	maxTokens?: number;
	/** Extra provider-specific kwargs. */
	extra?: Record<string, unknown>;
};

export interface ModelFactory {
	/** Builds the chat model configured for `role` in `settings` (keys from `secrets`). */
	forRole(
		role: ModelRole,
		settings: Settings,
		options?: CreateModelOptions,
	): Promise<BaseChatModel>;
	/** Builds a chat model from an explicit `provider:model` reference. */
	fromRef(ref: string, options?: CreateModelOptions): Promise<BaseChatModel>;
}

export type DoctorCheck = {
	id: string;
	label: string;
	ok: boolean;
	detail?: string;
	/** Remediation hint shown when `ok === false`. */
	fix?: string;
};
