import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelProfile } from "@langchain/core/language_models/profile";
import { describe, expect, it } from "vitest";
import { SettingsSchema } from "../schemas/index.js";
import { ScriptedChatModel } from "../testing/scripted-chat-model.js";
import { type InitChatModelFn, LangChainModelFactory, type OpenRouterCtor } from "./models.js";
import { StaticSecretsProvider } from "./secrets.js";
import { ProviderNotConfiguredError } from "./types.js";

const FAKE_KEY = "sk-test-SECRET-9f8e7d6c5b4a";

type InitCall = { model: string; fields: Record<string, unknown> | undefined };

/** A stand-in for `initChatModel` that records its parameters and returns a scripted model with a profile. */
function fakeInit(profile?: ModelProfile) {
	const calls: InitCall[] = [];
	const init: InitChatModelFn = async (model, fields) => {
		calls.push({ model, fields });
		const chat = new ScriptedChatModel({ script: ["ok"] });
		if (profile) Object.defineProperty(chat, "profile", { value: profile });
		return chat as unknown as BaseChatModel;
	};
	return { init, calls };
}

class FakeOpenRouter extends ScriptedChatModel {
	static instances: Record<string, unknown>[] = [];
	constructor(fields: Record<string, unknown>) {
		super({ script: ["ok"] });
		FakeOpenRouter.instances.push(fields);
	}
	override _llmType(): string {
		return "openrouter";
	}
	override get profile(): ModelProfile {
		return { maxOutputTokens: 64_000 };
	}
}

const factory = (secrets: Record<string, string>, profile?: ModelProfile) => {
	const { init, calls } = fakeInit(profile);
	const f = new LangChainModelFactory({
		secrets: new StaticSecretsProvider(secrets),
		init,
		openRouter: FakeOpenRouter as unknown as OpenRouterCtor,
	});
	return { factory: f, calls };
};

describe("LangChainModelFactory.fromRef", () => {
	it("throws ProviderNotConfiguredError naming the env var before touching the provider", async () => {
		const { factory: f, calls } = factory({});
		const promise = f.fromRef("openrouter:anthropic/claude-sonnet-5.5");
		await expect(promise).rejects.toBeInstanceOf(ProviderNotConfiguredError);
		await expect(promise).rejects.toThrow(/OPENROUTER_API_KEY/);
		await expect(f.fromRef("anthropic:claude-sonnet-5-5")).rejects.toThrow(/ANTHROPIC_API_KEY/);
		expect(calls).toHaveLength(0);
		expect(FakeOpenRouter.instances).toHaveLength(0);
	});

	it("rejects bare model names and unknown providers", async () => {
		const { factory: f } = factory({ OPENAI_API_KEY: FAKE_KEY });
		await expect(f.fromRef("gpt-5")).rejects.toThrow(/provider:model/);
		await expect(f.fromRef("nope:gpt-5")).rejects.toThrow(/nope/);
	});

	it("builds ChatOpenRouter directly (not via initChatModel) with the key and effort", async () => {
		FakeOpenRouter.instances = [];
		const { factory: f, calls } = factory({ OPENROUTER_API_KEY: FAKE_KEY });
		const model = await f.fromRef("openrouter:anthropic/claude-sonnet-5.5", {
			effort: "high",
			temperature: 0.2,
		});
		expect(model._llmType()).toBe("openrouter");
		expect(calls).toHaveLength(0);
		// Built once to read the profile, then again with the profile's output limit.
		expect(FakeOpenRouter.instances.at(-1)).toEqual({
			model: "anthropic/claude-sonnet-5.5",
			apiKey: FAKE_KEY,
			temperature: 0.2,
			maxTokens: 64_000,
			modelKwargs: { reasoning: { effort: "high" } },
		});
		expect(FakeOpenRouter.instances[0]).not.toHaveProperty("maxTokens");
	});

	it("calls initChatModel with modelProvider and omits temperature when undefined", async () => {
		const { factory: f, calls } = factory({ ANTHROPIC_API_KEY: FAKE_KEY });
		await f.fromRef("anthropic:claude-sonnet-5-5");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.model).toBe("claude-sonnet-5-5");
		expect(calls[0]?.fields).toEqual({ modelProvider: "anthropic", apiKey: FAKE_KEY });
		expect(calls[0]?.fields).not.toHaveProperty("temperature");
	});

	it("passes temperature, effort and extra kwargs through", async () => {
		const { factory: f, calls } = factory({ OPENAI_API_KEY: FAKE_KEY });
		await f.fromRef("openai:gpt-5", { temperature: 0, effort: "medium", extra: { topP: 0.9 } });
		expect(calls[0]?.fields).toEqual({
			modelProvider: "openai",
			apiKey: FAKE_KEY,
			temperature: 0,
			reasoning: { effort: "medium" },
			topP: 0.9,
		});
	});

	it("passes the base URL for ollama instead of an api key", async () => {
		const { factory: f, calls } = factory({ OLLAMA_BASE_URL: "http://localhost:11434" });
		await f.fromRef("ollama:llama3.2:latest", { effort: "none" });
		expect(calls[0]?.model).toBe("llama3.2:latest");
		expect(calls[0]?.fields).toEqual({
			modelProvider: "ollama",
			baseUrl: "http://localhost:11434",
			think: false,
		});
	});

	it("re-creates the model with maxTokens from the profile when the caller set none", async () => {
		const { factory: f, calls } = factory(
			{ ANTHROPIC_API_KEY: FAKE_KEY },
			{ maxOutputTokens: 64_000 },
		);
		await f.fromRef("anthropic:claude-sonnet-5-5");
		const last = calls.at(-1);
		expect(last?.fields).toEqual({
			modelProvider: "anthropic",
			apiKey: FAKE_KEY,
			maxTokens: 64_000,
		});
	});

	it("uses the provider's own output-limit field name (google-genai, ollama)", async () => {
		const google = factory({ GOOGLE_API_KEY: FAKE_KEY }, { maxOutputTokens: 65_536 });
		await google.factory.fromRef("google-genai:gemini-2.5-pro");
		expect(google.calls.at(-1)?.fields).toMatchObject({ maxOutputTokens: 65_536 });
		expect(google.calls.at(-1)?.fields).not.toHaveProperty("maxTokens");

		const ollama = factory(
			{ OLLAMA_BASE_URL: "http://localhost:11434" },
			{ maxOutputTokens: 8192 },
		);
		await ollama.factory.fromRef("ollama:qwen3:8b");
		expect(ollama.calls.at(-1)?.fields).toMatchObject({ numPredict: 8192 });
	});

	it("keeps the caller's maxTokens over the profile and does not re-create", async () => {
		const { factory: f, calls } = factory(
			{ ANTHROPIC_API_KEY: FAKE_KEY },
			{ maxOutputTokens: 64_000 },
		);
		await f.fromRef("anthropic:claude-sonnet-5-5", { maxTokens: 1024 });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.fields).toMatchObject({ maxTokens: 1024 });
	});

	it("skips maxTokens when the model has no profile", async () => {
		const { factory: f, calls } = factory({ ANTHROPIC_API_KEY: FAKE_KEY });
		await f.fromRef("anthropic:claude-sonnet-5-5");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.fields).not.toHaveProperty("maxTokens");
	});

	it("never puts the key into error messages", async () => {
		const init: InitChatModelFn = async () => {
			throw new Error(`boom ${FAKE_KEY}`);
		};
		const f = new LangChainModelFactory({
			secrets: new StaticSecretsProvider({ OPENAI_API_KEY: FAKE_KEY }),
			init,
			openRouter: FakeOpenRouter as unknown as OpenRouterCtor,
		});
		let message = "";
		try {
			await f.fromRef("openai:gpt-5");
		} catch (error) {
			message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
		}
		expect(message).toContain("boom");
		expect(message).not.toContain(FAKE_KEY);
	});
});

describe("LangChainModelFactory.forRole", () => {
	const settings = SettingsSchema.parse({
		models: { simulator: "openai:gpt-5", judge: "anthropic:claude-sonnet-5-5" },
		temperature: { simulator: 0.7 },
		effort: { simulator: "low", judge: "high" },
	});

	it("maps the judge's effort to anthropic thinking budget", async () => {
		const { factory: f, calls } = factory({
			ANTHROPIC_API_KEY: FAKE_KEY,
			OPENAI_API_KEY: FAKE_KEY,
		});
		await f.forRole("judge", settings);
		expect(calls[0]?.model).toBe("claude-sonnet-5-5");
		expect(calls[0]?.fields).toEqual({
			modelProvider: "anthropic",
			apiKey: FAKE_KEY,
			thinking: { type: "enabled", budget_tokens: 16384 },
		});
	});

	it("maps the simulator's effort and temperature to openai", async () => {
		const { factory: f, calls } = factory({
			ANTHROPIC_API_KEY: FAKE_KEY,
			OPENAI_API_KEY: FAKE_KEY,
		});
		await f.forRole("simulator", settings);
		expect(calls[0]?.fields).toEqual({
			modelProvider: "openai",
			apiKey: FAKE_KEY,
			temperature: 0.7,
			reasoning: { effort: "low" },
		});
	});

	it("evidence_selector falls back to the judge configuration", async () => {
		const { factory: f, calls } = factory({
			ANTHROPIC_API_KEY: FAKE_KEY,
			OPENAI_API_KEY: FAKE_KEY,
		});
		await f.forRole("evidence_selector", settings);
		expect(calls[0]?.model).toBe("claude-sonnet-5-5");
		expect(calls[0]?.fields).toMatchObject({ thinking: { budget_tokens: 16384 } });
	});

	it("explicit options override the settings for the role", async () => {
		const { factory: f, calls } = factory({
			OPENAI_API_KEY: FAKE_KEY,
			ANTHROPIC_API_KEY: FAKE_KEY,
		});
		await f.forRole("simulator", settings, { effort: "none", temperature: 0 });
		expect(calls[0]?.fields).toEqual({ modelProvider: "openai", apiKey: FAKE_KEY, temperature: 0 });
	});
});
