import { z } from "zod";
import { SlugSchema } from "./common.js";

export const ExpectedArtifactSchema = z.object({
	type: z.enum(["download", "image", "link"]),
	/** MIME type or glob-ish pattern, e.g. `application/pdf`, `text/*`. */
	mime: z.string().optional(),
	/** Natural-language description of what the artifact should contain. */
	description: z.string().optional(),
});
export type ExpectedArtifact = z.output<typeof ExpectedArtifactSchema>;

/** `scenarios/<name>.yaml` — goal and intent are natural language; the simulator improvises the wording. */
export const ScenarioSchema = z.object({
	name: SlugSchema,
	description: z.string().optional(),
	persona: SlugSchema,
	target: SlugSchema,
	/** Rubric name; falls back to `evaluator.yaml#default_rubric`. */
	rubric: SlugSchema.optional(),
	goal: z.string().min(1),
	intent: z.string().min(1),
	/** Preconditions or background the simulated user knows. */
	context: z.string().optional(),
	/** Example of how the user might open — an inspiration, never a script. */
	opening_message_example: z.string().optional(),
	/** More examples of user phrasing. */
	examples: z.array(z.string().min(1)).default([]),
	/** When the simulated user should consider the goal reached (natural language). */
	success_criteria: z.string().min(1),
	/** Maximum user → bot exchanges; exceeding it without reaching the goal fails the run. */
	max_turns: z.number().int().positive().max(100),
	expected_artifacts: z.array(ExpectedArtifactSchema).default([]),
	/** Run the scenario N times to observe non-determinism. */
	repeat: z.number().int().positive().max(50).default(1),
	/** Enable screenshot-based (xy) interaction tools in addition to a11y refs. */
	vision: z.boolean().default(false),
	tags: z.array(z.string().min(1)).default([]),
});
export type Scenario = z.output<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;
