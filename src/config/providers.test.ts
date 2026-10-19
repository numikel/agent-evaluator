import { describe, expect, it } from "vitest";
import anthropicFixture from "./fixtures/anthropic.json" with { type: "json" };
import googleFixture from "./fixtures/google-genai.json" with { type: "json" };
import groqFixture from "./fixtures/groq.json" with { type: "json" };
import mistralFixture from "./fixtures/mistralai.json" with { type: "json" };
import ollamaFixture from "./fixtures/ollama.json" with { type: "json" };
import openaiFixture from "./fixtures/openai.json" with { type: "json" };
import openrouterFixture from "./fixtures/openrouter.json" with { type: "json" };
import xaiFixture from "./fixtures/xai.json" with { type: "json" };
import xaiModelsFixture from "./fixtures/xai-models.json" with { type: "json" };
import { createProviderRegistry, parseRef, UnknownProviderError } from "./providers.js";
import { StaticSecretsProvider } from "./secrets.js";

const FAKE_KEY = "sk-test-SECRET-9f8e7d6c5b4a";

type FetchCall = { url: string; init: RequestInit | undefined };

/** Records every call and answers with the handler's response; never touches the network. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	const calls: FetchCall[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		calls.push({ url, init });
		return handler(url, init);
	}) as unknown as typeof fetch;
	return { fn, calls };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const headerOf = (init: RequestInit | undefined, name: string): string | undefined => {
	const headers = new Headers(init?.headers);
	return headers.get(name) ?? undefined;
};

describe("parseRef", () => {
	it("splits provider and model on the first colon", () => {
		expect(parseRef("anthropic:claude-sonnet-5-5")).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-5-5",
		});
	});

	it("keeps colons inside the model id (ollama tags, openrouter variants)", () => {
		expect(parseRef("ollama:llama3.2:latest")).toEqual({
			provider: "ollama",
			model: "llama3.2:latest",
		});
	});

	it("rejects bare model names with the schema's message", () => {
		expect(() => parseRef("gpt-5")).toThrow("must be an explicit 'provider:model' reference");
		expect(() => parseRef("anthropic:")).toThrow("must be an explicit 'provider:model' reference");
	});
});

describe("registry table", () => {
	const registry = createProviderRegistry();

	it("lists the eight supported providers with their env vars", () => {
		const byId = Object.fromEntries(registry.all().map((p) => [p.id, p.env]));
		expect(byId).toEqual({
			anthropic: "ANTHROPIC_API_KEY",
			openai: "OPENAI_API_KEY",
			"google-genai": "GOOGLE_API_KEY",
			openrouter: "OPENROUTER_API_KEY",
			xai: "XAI_API_KEY",
			mistralai: "MISTRAL_API_KEY",
			groq: "GROQ_API_KEY",
			ollama: "OLLAMA_BASE_URL",
		});
	});

	it("maps each provider to its effort knob and langchain package", () => {
		const defs = Object.fromEntries(registry.all().map((p) => [p.id, p]));
		expect(defs.anthropic?.package).toBe("@langchain/anthropic");
		expect(defs.anthropic?.effortKnob).toBe("anthropic");
		expect(defs.openai?.effortKnob).toBe("openai");
		expect(defs.xai?.effortKnob).toBe("openai");
		expect(defs["google-genai"]?.effortKnob).toBe("google");
		expect(defs.groq?.effortKnob).toBe("groq");
		expect(defs.ollama?.effortKnob).toBe("ollama");
		expect(defs.openrouter?.effortKnob).toBe("openrouter");
		expect(defs.mistralai?.effortKnob).toBe("none");
		for (const def of registry.all()) {
			expect(def.examples.length).toBeGreaterThan(0);
			expect(def.modelsEndpoint).toMatch(/^https?:\/\//);
		}
	});
});

describe("status() and configured()", () => {
	it("reports configured flags without ever exposing values", () => {
		const registry = createProviderRegistry();
		const secrets = new StaticSecretsProvider({ ANTHROPIC_API_KEY: FAKE_KEY });
		const status = registry.status(secrets);
		expect(status).toHaveLength(registry.all().length);
		expect(status.find((s) => s.id === "anthropic")).toEqual({
			id: "anthropic",
			label: expect.any(String),
			env: "ANTHROPIC_API_KEY",
			configured: true,
		});
		expect(status.find((s) => s.id === "openai")?.configured).toBe(false);
		expect(JSON.stringify(status)).not.toContain(FAKE_KEY);
	});

	it("configured() returns only providers whose env var is set", () => {
		const registry = createProviderRegistry();
		const secrets = new StaticSecretsProvider({
			OPENAI_API_KEY: FAKE_KEY,
			OLLAMA_BASE_URL: "http://localhost:11434",
			GROQ_API_KEY: "",
		});
		expect(registry.configured(secrets).map((p) => p.id)).toEqual(["openai", "ollama"]);
		expect(registry.configured(new StaticSecretsProvider({}))).toEqual([]);
	});
});

describe("listModels()", () => {
	it("openai: maps data[].id with Bearer auth", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(openaiFixture));
		const result = await registry.listModels(
			"openai",
			new StaticSecretsProvider({ OPENAI_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
		expect(headerOf(calls[0]?.init, "authorization")).toBe(`Bearer ${FAKE_KEY}`);
		expect(result.source).toBe("api");
		expect(result.error).toBeUndefined();
		expect(result.models.map((m) => m.ref)).toEqual([
			"openai:gpt-5",
			"openai:gpt-5-mini",
			"openai:text-embedding-3-small",
		]);
		expect(result.models[0]).toEqual({
			provider: "openai",
			id: "gpt-5",
			label: "gpt-5",
			ref: "openai:gpt-5",
		});
	});

	it("anthropic: uses x-api-key + anthropic-version and display_name as label", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(anthropicFixture));
		const result = await registry.listModels(
			"anthropic",
			new StaticSecretsProvider({ ANTHROPIC_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models");
		expect(headerOf(calls[0]?.init, "x-api-key")).toBe(FAKE_KEY);
		expect(headerOf(calls[0]?.init, "anthropic-version")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(result.source).toBe("api");
		expect(result.models[0]).toEqual({
			provider: "anthropic",
			id: "claude-sonnet-5-5",
			label: "Claude Sonnet 5.5",
			ref: "anthropic:claude-sonnet-5-5",
		});
	});

	it("google-genai: query-string key, strips models/, keeps generateContent models, maps limits", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(googleFixture));
		const result = await registry.listModels(
			"google-genai",
			new StaticSecretsProvider({ GOOGLE_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe(
			`https://generativelanguage.googleapis.com/v1beta/models?key=${FAKE_KEY}`,
		);
		expect(result.source).toBe("api");
		expect(result.models).toEqual([
			{
				provider: "google-genai",
				id: "gemini-2.5-pro",
				label: "Gemini 2.5 Pro",
				ref: "google-genai:gemini-2.5-pro",
				context_window: 1_048_576,
				max_output_tokens: 65_536,
				supports_reasoning: true,
			},
		]);
	});

	it("openrouter: maps context, max completion tokens, reasoning, images and tools", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(openrouterFixture));
		const result = await registry.listModels(
			"openrouter",
			new StaticSecretsProvider({ OPENROUTER_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/models");
		expect(headerOf(calls[0]?.init, "authorization")).toBe(`Bearer ${FAKE_KEY}`);
		expect(result.models).toEqual([
			{
				provider: "openrouter",
				id: "anthropic/claude-sonnet-5.5",
				label: "Anthropic: Claude Sonnet 5.5",
				ref: "openrouter:anthropic/claude-sonnet-5.5",
				context_window: 1_000_000,
				max_output_tokens: 64_000,
				supports_reasoning: true,
				supports_images: true,
				supports_tools: true,
			},
			{
				provider: "openrouter",
				id: "mistralai/mistral-small",
				label: "Mistral: Mistral Small",
				ref: "openrouter:mistralai/mistral-small",
				context_window: 32_000,
				supports_reasoning: false,
				supports_images: false,
				supports_tools: false,
			},
		]);
	});

	it("xai: uses /v1/language-models and input_modalities", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(xaiFixture));
		const result = await registry.listModels(
			"xai",
			new StaticSecretsProvider({ XAI_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe("https://api.x.ai/v1/language-models");
		expect(headerOf(calls[0]?.init, "authorization")).toBe(`Bearer ${FAKE_KEY}`);
		expect(result.source).toBe("api");
		expect(result.models).toEqual([
			{ provider: "xai", id: "grok-4", label: "grok-4", ref: "xai:grok-4", supports_images: true },
			{
				provider: "xai",
				id: "grok-3-mini",
				label: "grok-3-mini",
				ref: "xai:grok-3-mini",
				supports_images: false,
			},
		]);
	});

	it("xai: falls back to /v1/models when language-models is unavailable", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch((url) =>
			url.endsWith("/v1/language-models") ? json({ error: "nope" }, 404) : json(xaiModelsFixture),
		);
		const result = await registry.listModels(
			"xai",
			new StaticSecretsProvider({ XAI_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls.map((c) => c.url)).toEqual([
			"https://api.x.ai/v1/language-models",
			"https://api.x.ai/v1/models",
		]);
		expect(result.source).toBe("api");
		expect(result.models.map((m) => m.id)).toEqual(["grok-4", "grok-3-mini"]);
	});

	it("mistralai: keeps chat-capable models and maps context, vision and tools", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(mistralFixture));
		const result = await registry.listModels(
			"mistralai",
			new StaticSecretsProvider({ MISTRAL_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe("https://api.mistral.ai/v1/models");
		expect(headerOf(calls[0]?.init, "authorization")).toBe(`Bearer ${FAKE_KEY}`);
		expect(result.models).toEqual([
			{
				provider: "mistralai",
				id: "mistral-large-latest",
				label: "mistral-large-latest",
				ref: "mistralai:mistral-large-latest",
				context_window: 131_072,
				supports_images: false,
				supports_tools: true,
			},
			{
				provider: "mistralai",
				id: "pixtral-large-latest",
				label: "pixtral-large-latest",
				ref: "mistralai:pixtral-large-latest",
				context_window: 131_072,
				supports_images: true,
				supports_tools: true,
			},
		]);
	});

	it("groq: maps context_window and max_completion_tokens", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(groqFixture));
		const result = await registry.listModels(
			"groq",
			new StaticSecretsProvider({ GROQ_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe("https://api.groq.com/openai/v1/models");
		expect(headerOf(calls[0]?.init, "authorization")).toBe(`Bearer ${FAKE_KEY}`);
		expect(result.models[0]).toEqual({
			provider: "groq",
			id: "llama-3.3-70b-versatile",
			label: "llama-3.3-70b-versatile",
			ref: "groq:llama-3.3-70b-versatile",
			context_window: 131_072,
			max_output_tokens: 32_768,
		});
		expect(result.models.map((m) => m.id)).toContain("whisper-large-v3");
	});

	it("ollama: calls $OLLAMA_BASE_URL/api/tags without auth", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(ollamaFixture));
		const result = await registry.listModels(
			"ollama",
			new StaticSecretsProvider({ OLLAMA_BASE_URL: "http://127.0.0.1:11434/" }),
			{ fetch: fn },
		);
		expect(calls[0]?.url).toBe("http://127.0.0.1:11434/api/tags");
		expect(headerOf(calls[0]?.init, "authorization")).toBeUndefined();
		expect(result.models).toEqual([
			{
				provider: "ollama",
				id: "llama3.2:latest",
				label: "llama3.2:latest",
				ref: "ollama:llama3.2:latest",
			},
			{ provider: "ollama", id: "qwen3:8b", label: "qwen3:8b", ref: "ollama:qwen3:8b" },
		]);
	});

	it("falls back to examples on a 401 without throwing or leaking the key", async () => {
		const registry = createProviderRegistry();
		const { fn } = fakeFetch(() =>
			json({ error: { message: `Incorrect API key provided: ${FAKE_KEY}` } }, 401),
		);
		const result = await registry.listModels(
			"openai",
			new StaticSecretsProvider({ OPENAI_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(result.source).toBe("fallback");
		expect(result.error).toMatch(/401/);
		expect(result.models.length).toBeGreaterThan(0);
		expect(result.models.every((m) => m.provider === "openai" && m.ref.startsWith("openai:"))).toBe(
			true,
		);
		expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
	});

	it("falls back on a network error and never includes the key (even from the URL)", async () => {
		const registry = createProviderRegistry();
		const { fn } = fakeFetch((url) => {
			throw new TypeError(`fetch failed: ${url}`);
		});
		const result = await registry.listModels(
			"google-genai",
			new StaticSecretsProvider({ GOOGLE_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(result.source).toBe("fallback");
		expect(result.error).toContain("fetch failed");
		expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
	});

	it("falls back on malformed JSON", async () => {
		const registry = createProviderRegistry();
		const { fn } = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
		const result = await registry.listModels(
			"anthropic",
			new StaticSecretsProvider({ ANTHROPIC_API_KEY: FAKE_KEY }),
			{ fetch: fn },
		);
		expect(result.source).toBe("fallback");
		expect(result.error).toBeTruthy();
	});

	it("falls back when the provider is not configured, without calling fetch", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(openaiFixture));
		const result = await registry.listModels("openai", new StaticSecretsProvider({}), {
			fetch: fn,
		});
		expect(calls).toHaveLength(0);
		expect(result.source).toBe("fallback");
		expect(result.error).toContain("OPENAI_API_KEY");
	});

	it("falls back for an unknown provider", async () => {
		const registry = createProviderRegistry();
		const { fn, calls } = fakeFetch(() => json(openaiFixture));
		const result = await registry.listModels("nope", new StaticSecretsProvider({}), { fetch: fn });
		expect(calls).toHaveLength(0);
		expect(result).toEqual({
			models: [],
			source: "fallback",
			error: expect.stringContaining("nope"),
		});
	});

	it("serves the cache for 10 minutes and refetches with refresh: true", async () => {
		let now = 1_000_000;
		const registry = createProviderRegistry({ now: () => now });
		const { fn, calls } = fakeFetch(() => json(openaiFixture));
		const secrets = new StaticSecretsProvider({ OPENAI_API_KEY: FAKE_KEY });

		await registry.listModels("openai", secrets, { fetch: fn });
		await registry.listModels("openai", secrets, { fetch: fn });
		expect(calls).toHaveLength(1);

		await registry.listModels("openai", secrets, { fetch: fn, refresh: true });
		expect(calls).toHaveLength(2);

		now += 10 * 60 * 1000 - 1;
		await registry.listModels("openai", secrets, { fetch: fn });
		expect(calls).toHaveLength(2);

		now += 2;
		await registry.listModels("openai", secrets, { fetch: fn });
		expect(calls).toHaveLength(3);
	});

	it("does not cache failures", async () => {
		const registry = createProviderRegistry();
		let fail = true;
		const { fn, calls } = fakeFetch(() => (fail ? json({}, 500) : json(openaiFixture)));
		const secrets = new StaticSecretsProvider({ OPENAI_API_KEY: FAKE_KEY });
		expect((await registry.listModels("openai", secrets, { fetch: fn })).source).toBe("fallback");
		fail = false;
		expect((await registry.listModels("openai", secrets, { fetch: fn })).source).toBe("api");
		expect(calls).toHaveLength(2);
	});
});

describe("UnknownProviderError", () => {
	it("is thrown by parseRef for unknown providers only when asked", () => {
		expect(() => parseRef("nope:model")).not.toThrow();
		const registry = createProviderRegistry();
		expect(() => registry.parseRef("nope:model")).toThrow(UnknownProviderError);
		expect(() => registry.parseRef("nope:model")).toThrow(/nope/);
	});
});
