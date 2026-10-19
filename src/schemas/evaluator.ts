import { z } from "zod";
import { SlugSchema } from "./common.js";

/** `evaluator.yaml` — global judge configuration written by the user in natural language. */
export const EvaluatorConfigSchema = z.object({
	/** General rules about how the chatbot should behave, which tools it should use, etc. */
	principles: z.string().min(1),
	/** Upper bound of screenshots passed to the judge model per run. */
	max_images: z.number().int().nonnegative().max(50).default(10),
	/** Rubric used when a scenario does not name one. */
	default_rubric: SlugSchema.optional(),
	/** `llm`: a selector model picks key steps from the transcript; `uniform`: evenly spaced steps. */
	evidence_selection: z.enum(["llm", "uniform"]).default("llm"),
	/** Extra instructions appended to every judge prompt. */
	judge_instructions: z.string().optional(),
});
export type EvaluatorConfig = z.output<typeof EvaluatorConfigSchema>;
