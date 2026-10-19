import type { Effort } from "../schemas/index.js";
import type { ProviderDefinition } from "./types.js";

export type EffortKnob = ProviderDefinition["effortKnob"];

type Level = Exclude<Effort, "none">;

const OPENAI_LEVELS: Record<Level, string> = {
	low: "low",
	medium: "medium",
	high: "high",
	max: "high",
};
const ANTHROPIC_BUDGETS: Record<Level, number> = {
	low: 2048,
	medium: 8192,
	high: 16384,
	max: 32000,
};
const GOOGLE_BUDGETS: Record<Effort, number> = {
	none: 0,
	low: 2048,
	medium: 8192,
	high: 16384,
	max: 24576,
};

/**
 * Maps the provider-agnostic `effort` level onto the constructor parameter each LangChain provider
 * package exposes (verified against the installed `.d.ts` files on 2026-10-19):
 *
 * | knob       | none  | low  | medium | high  | max   | parameter                                   |
 * | ---------- | ----- | ---- | ------ | ----- | ----- | ------------------------------------------- |
 * | openai/xai | omit  | low  | medium | high  | high  | `reasoning: { effort }` (see note below)    |
 * | anthropic  | omit  | 2048 | 8192   | 16384 | 32000 | `thinking: { type: "enabled", budget_tokens }` |
 * | google     | 0     | 2048 | 8192   | 16384 | 24576 | `thinkingConfig: { thinkingBudget }`        |
 * | groq       | none  | low  | medium | high  | high  | `reasoningEffort`                           |
 * | ollama     | false | true | true   | true  | true  | `think`                                     |
 * | openrouter | omit  | low  | medium | high  | high  | `modelKwargs: { reasoning: { effort } }`    |
 * | none       | ignored (e.g. mistralai)                                                             |
 *
 * An undefined `effort` returns `{}` so the provider default applies.
 *
 * Note on openai/xai: the phase brief names `reasoningEffort`, but in the installed
 * `@langchain/openai` that field is deprecated and only honoured as a per-call option; the
 * constructor reads `reasoning.effort`, which is what reaches the request as `reasoning_effort`.
 * `ChatXAI` shares that base class. Groq's constructor does take `reasoningEffort`.
 */
export function effortParams(
	knob: EffortKnob,
	effort: Effort | undefined,
): Record<string, unknown> {
	if (effort === undefined) return {};
	switch (knob) {
		case "openai":
			return effort === "none" ? {} : { reasoning: { effort: OPENAI_LEVELS[effort] } };
		case "anthropic":
			return effort === "none"
				? {}
				: { thinking: { type: "enabled", budget_tokens: ANTHROPIC_BUDGETS[effort] } };
		case "google":
			return { thinkingConfig: { thinkingBudget: GOOGLE_BUDGETS[effort] } };
		case "groq":
			return { reasoningEffort: effort === "none" ? "none" : OPENAI_LEVELS[effort] };
		case "ollama":
			return { think: effort !== "none" };
		case "openrouter":
			return effort === "none"
				? {}
				: { modelKwargs: { reasoning: { effort: OPENAI_LEVELS[effort] } } };
		case "none":
			return {};
	}
}
