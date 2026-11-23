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
/**
 * Claude models that accept only adaptive thinking (`thinking: { type: "adaptive" }` plus
 * `output_config.effort`) and reject `thinking.type: "enabled"` with `budget_tokens`. Same prefixes
 * as `@langchain/anthropic` (`ADAPTIVE_ONLY_MODEL_PREFIXES`, not exported), which validates this
 * client-side; provider-wire.test.ts runs every effort level through it for each model family.
 */
const ANTHROPIC_ADAPTIVE_ONLY_PREFIXES = [
	"claude-opus-4-7",
	"claude-opus-4-8",
	"claude-opus-5",
	"claude-sonnet-5",
	"claude-fable-5",
	"claude-mythos-5",
	"claude-mythos-preview",
];

const isAnthropicAdaptiveOnly = (model: string | undefined): boolean =>
	model !== undefined && ANTHROPIC_ADAPTIVE_ONLY_PREFIXES.some((p) => model.startsWith(p));

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
 * | (adaptive) | omit  | low  | medium | high  | max   | `thinking: adaptive`, `outputConfig.effort`   |
 * | google     | 0     | 2048 | 8192   | 16384 | 24576 | `thinkingConfig: { thinkingBudget }`        |
 * | groq       | none  | low  | medium | high  | high  | `reasoningEffort`                           |
 * | ollama     | false | true | true   | true  | true  | `think`                                     |
 * | openrouter | omit  | low  | medium | high  | high  | `modelKwargs: { reasoning: { effort } }`    |
 * | none       | ignored (e.g. mistralai)                                                             |
 *
 * An undefined `effort` returns `{}` so the provider default applies. "(adaptive)" is the Anthropic
 * row for models that accept only adaptive thinking (Opus 4.7+, Claude 5; see
 * `ANTHROPIC_ADAPTIVE_ONLY_PREFIXES`), which is why the model id is needed.
 *
 * Note on openai/xai: the phase brief names `reasoningEffort`, but in the installed
 * `@langchain/openai` that field is deprecated and only honoured as a per-call option; the
 * constructor reads `reasoning.effort`, which is what reaches the request as `reasoning_effort`.
 * `ChatXAI` shares that base class. Groq's constructor does take `reasoningEffort`.
 */
export function effortParams(
	knob: EffortKnob,
	effort: Effort | undefined,
	model?: string,
): Record<string, unknown> {
	if (effort === undefined) return {};
	switch (knob) {
		case "openai":
			return effort === "none" ? {} : { reasoning: { effort: OPENAI_LEVELS[effort] } };
		case "anthropic":
			if (effort === "none") return {};
			return isAnthropicAdaptiveOnly(model)
				? { thinking: { type: "adaptive" }, outputConfig: { effort } }
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
