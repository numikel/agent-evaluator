import { describe, expect, it } from "vitest";
import { EFFORT_LEVELS } from "../schemas/index.js";
import { effortParams } from "./effort.js";

describe("effortParams", () => {
	it("openai (also xai): reasoning.effort, omitted for none", () => {
		expect(effortParams("openai", "none")).toEqual({});
		expect(effortParams("openai", "low")).toEqual({ reasoning: { effort: "low" } });
		expect(effortParams("openai", "medium")).toEqual({ reasoning: { effort: "medium" } });
		expect(effortParams("openai", "high")).toEqual({ reasoning: { effort: "high" } });
		expect(effortParams("openai", "max")).toEqual({ reasoning: { effort: "high" } });
	});

	it("anthropic: thinking budget tokens, omitted for none", () => {
		expect(effortParams("anthropic", "none")).toEqual({});
		expect(effortParams("anthropic", "low")).toEqual({
			thinking: { type: "enabled", budget_tokens: 2048 },
		});
		expect(effortParams("anthropic", "medium")).toEqual({
			thinking: { type: "enabled", budget_tokens: 8192 },
		});
		expect(effortParams("anthropic", "high")).toEqual({
			thinking: { type: "enabled", budget_tokens: 16384 },
		});
		expect(effortParams("anthropic", "max")).toEqual({
			thinking: { type: "enabled", budget_tokens: 32000 },
		});
	});

	it("google: thinkingConfig.thinkingBudget, 0 for none", () => {
		expect(effortParams("google", "none")).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
		expect(effortParams("google", "low")).toEqual({ thinkingConfig: { thinkingBudget: 2048 } });
		expect(effortParams("google", "medium")).toEqual({ thinkingConfig: { thinkingBudget: 8192 } });
		expect(effortParams("google", "high")).toEqual({ thinkingConfig: { thinkingBudget: 16384 } });
		expect(effortParams("google", "max")).toEqual({ thinkingConfig: { thinkingBudget: 24576 } });
	});

	it("groq: reasoningEffort including an explicit none", () => {
		expect(effortParams("groq", "none")).toEqual({ reasoningEffort: "none" });
		expect(effortParams("groq", "low")).toEqual({ reasoningEffort: "low" });
		expect(effortParams("groq", "medium")).toEqual({ reasoningEffort: "medium" });
		expect(effortParams("groq", "high")).toEqual({ reasoningEffort: "high" });
		expect(effortParams("groq", "max")).toEqual({ reasoningEffort: "high" });
	});

	it("ollama: think boolean", () => {
		expect(effortParams("ollama", "none")).toEqual({ think: false });
		expect(effortParams("ollama", "low")).toEqual({ think: true });
		expect(effortParams("ollama", "medium")).toEqual({ think: true });
		expect(effortParams("ollama", "high")).toEqual({ think: true });
		expect(effortParams("ollama", "max")).toEqual({ think: true });
	});

	it("openrouter: modelKwargs.reasoning.effort, omitted for none", () => {
		expect(effortParams("openrouter", "none")).toEqual({});
		expect(effortParams("openrouter", "low")).toEqual({
			modelKwargs: { reasoning: { effort: "low" } },
		});
		expect(effortParams("openrouter", "medium")).toEqual({
			modelKwargs: { reasoning: { effort: "medium" } },
		});
		expect(effortParams("openrouter", "high")).toEqual({
			modelKwargs: { reasoning: { effort: "high" } },
		});
		expect(effortParams("openrouter", "max")).toEqual({
			modelKwargs: { reasoning: { effort: "high" } },
		});
	});

	it("none knob ignores every level", () => {
		for (const level of EFFORT_LEVELS) expect(effortParams("none", level)).toEqual({});
	});

	it("undefined effort leaves the provider default for every knob", () => {
		for (const knob of [
			"openai",
			"anthropic",
			"google",
			"groq",
			"ollama",
			"openrouter",
			"none",
		] as const) {
			expect(effortParams(knob, undefined)).toEqual({});
		}
	});
});
