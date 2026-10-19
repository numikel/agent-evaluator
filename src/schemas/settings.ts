import { z } from "zod";
import { ModelRefSchema } from "./common.js";

export const MODEL_ROLES = ["simulator", "judge", "evidence_selector"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const DEFAULT_MODEL_REF = "anthropic:claude-sonnet-5-5";

/**
 * Provider-agnostic reasoning effort. The model factory maps it to each provider's own knob
 * (OpenAI `reasoningEffort`, Anthropic `thinking.budget_tokens`, Google `thinkingConfig`,
 * Groq `reasoningEffort`, Ollama `think`); providers without a knob ignore it.
 */
export const EFFORT_LEVELS = ["none", "low", "medium", "high", "max"] as const;
export const EffortSchema = z.enum(EFFORT_LEVELS);
export type Effort = z.output<typeof EffortSchema>;

/** `agent-evaluator.yaml` — workspace settings (no secrets; keys come from the environment). */
export const SettingsSchema = z.object({
	models: z
		.object({
			simulator: ModelRefSchema.default(DEFAULT_MODEL_REF),
			judge: ModelRefSchema.default(DEFAULT_MODEL_REF),
			/** Defaults to the judge model when omitted. */
			evidence_selector: ModelRefSchema.optional(),
		})
		.prefault({}),
	/** Optional per-role temperature; omitted keys are not sent to the provider. */
	temperature: z
		.object({
			simulator: z.number().min(0).max(2).optional(),
			judge: z.number().min(0).max(2).optional(),
			evidence_selector: z.number().min(0).max(2).optional(),
		})
		.optional(),
	/** Optional per-role reasoning effort; omitted keys leave the provider default. */
	effort: z
		.object({
			simulator: EffortSchema.optional(),
			judge: EffortSchema.optional(),
			evidence_selector: EffortSchema.optional(),
		})
		.optional(),
	browser: z
		.object({
			headless: z.boolean().default(true),
			slow_mo_ms: z.number().int().nonnegative().default(0),
		})
		.prefault({}),
	/** Number of scenarios executed in parallel browser contexts. */
	concurrency: z.number().int().positive().max(16).default(1),
	runs_dir: z.string().min(1).default("runs"),
	server: z
		.object({
			port: z.number().int().positive().max(65_535).default(4747),
			host: z.string().default("127.0.0.1"),
		})
		.prefault({}),
});
export type Settings = z.output<typeof SettingsSchema>;
export type SettingsInput = z.input<typeof SettingsSchema>;
