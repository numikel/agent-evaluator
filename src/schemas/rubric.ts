import { z } from "zod";
import { SlugSchema } from "./common.js";

const CriterionBase = z.object({
	id: SlugSchema.or(z.string().regex(/^[a-z0-9_]+$/, "must be snake_case or kebab-case")),
	description: z.string().min(1),
	weight: z.number().positive().default(1),
	/** A failing required criterion fails the whole run regardless of the aggregate score. */
	required: z.boolean().default(false),
});

/** Scored by the judge model against a natural-language description. */
export const LlmCriterionSchema = CriterionBase.extend({
	type: z.literal("llm"),
	scale: z.enum(["binary", "0-1", "0-5"]).default("0-5"),
	/** Optional anchors for each level, e.g. `{ "0": "rude", "5": "warm and concise" }`. */
	levels: z.record(z.string(), z.string()).optional(),
});

export const ContainsCriterionSchema = CriterionBase.extend({
	type: z.literal("contains"),
	text: z.string().min(1),
	/** Where to look: bot replies (default), user messages, or downloaded file text. */
	in: z.enum(["bot", "user", "files", "any"]).default("bot"),
	case_sensitive: z.boolean().default(false),
});

export const RegexCriterionSchema = CriterionBase.extend({
	type: z.literal("regex"),
	pattern: z.string().min(1),
	flags: z
		.string()
		.regex(/^[gimsuy]*$/)
		.default(""),
	in: z.enum(["bot", "user", "files", "any"]).default("bot"),
});

export const FileCriterionSchema = CriterionBase.extend({
	type: z.literal("file"),
	/** Expected MIME type (exact or `type/*`). */
	mime: z.string().optional(),
	min_bytes: z.number().int().nonnegative().optional(),
	/** Text that must appear in the extracted file content. */
	contains: z.string().optional(),
});

export const MaxResponseTimeCriterionSchema = CriterionBase.extend({
	type: z.literal("max_response_time_ms"),
	value: z.number().int().positive(),
	/** `p50`, `p95` or `max` over all bot replies. */
	aggregate: z.enum(["max", "p95", "p50"]).default("max"),
});

export const NoConsoleErrorsCriterionSchema = CriterionBase.extend({
	type: z.literal("no_console_errors"),
	/** Regex patterns of console errors to ignore. */
	ignore: z.array(z.string()).default([]),
});

export const CriterionSchema = z.discriminatedUnion("type", [
	LlmCriterionSchema,
	ContainsCriterionSchema,
	RegexCriterionSchema,
	FileCriterionSchema,
	MaxResponseTimeCriterionSchema,
	NoConsoleErrorsCriterionSchema,
]);
export type Criterion = z.output<typeof CriterionSchema>;
export type CriterionType = Criterion["type"];

/** `rubrics/<name>.yaml` */
export const RubricSchema = z
	.object({
		name: SlugSchema,
		description: z.string().optional(),
		/** Aggregate weighted score (0..1) required to pass. */
		pass_threshold: z.number().min(0).max(1).default(0.7),
		criteria: z.array(CriterionSchema).min(1),
	})
	.superRefine((rubric, ctx) => {
		const seen = new Set<string>();
		rubric.criteria.forEach((c, i) => {
			if (seen.has(c.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["criteria", i, "id"],
					message: `duplicate criterion id "${c.id}"`,
				});
			}
			seen.add(c.id);
		});
	});
export type Rubric = z.output<typeof RubricSchema>;

export const GOAL_REACHED_CRITERION_ID = "goal_reached";

/** Built-in criterion every rubric gets unless the author overrides it by id. */
export const goalReachedCriterion = (): Criterion => ({
	id: GOAL_REACHED_CRITERION_ID,
	type: "llm",
	description:
		"The simulated user's goal, as defined in the scenario, was fully achieved within the turn budget. Judge strictly against the scenario's success criteria.",
	weight: 3,
	required: true,
	scale: "binary",
});

/** Returns a copy of the rubric with built-in criteria prepended (author-defined ones win by id). */
export function withBuiltinCriteria(rubric: Rubric): Rubric {
	const hasGoal = rubric.criteria.some((c) => c.id === GOAL_REACHED_CRITERION_ID);
	return hasGoal ? rubric : { ...rubric, criteria: [goalReachedCriterion(), ...rubric.criteria] };
}
