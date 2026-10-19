/**
 * Picks which step screenshots the judge gets to see (≤ `max_images`).
 * `uniform`: evenly spaced steps that have a screenshot, always keeping the first and the last.
 * `llm`: a selector model reads the transcript + step list and names the key steps; any failure
 * (throw, invalid shape, nothing usable) falls back to `uniform` so a verdict is always produced.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { Step, TranscriptEntry } from "../../schemas/index.js";
import { formatStepList, formatTranscript } from "./prompt.js";
import type { EvidenceSelection, EvidenceStrategy } from "./types.js";

export const SelectorOutputSchema = z.object({
	/** Step indexes (as listed) whose screenshots matter most for judging the run. */
	steps: z.array(z.number().int().positive()),
});
export type SelectorOutput = z.output<typeof SelectorOutputSchema>;

export type SelectEvidenceInput = {
	steps: Step[];
	transcript: TranscriptEntry[];
	maxImages: number;
	strategy: EvidenceStrategy;
	selectorModel?: BaseChatModel | undefined;
};

const withScreenshot = (steps: Step[]): Step[] =>
	steps.filter((s) => typeof s.screenshot === "string" && s.screenshot.length > 0);

/** Evenly spaced steps with a screenshot; first and last are always included when `max >= 2`. */
export function uniformSelection(steps: Step[], maxImages: number): Step[] {
	const candidates = withScreenshot(steps);
	const count = Math.min(Math.max(0, Math.floor(maxImages)), candidates.length);
	if (count === 0) return [];
	if (count === 1) return [candidates[candidates.length - 1] as Step];
	if (count === candidates.length) return candidates;
	const picked = new Set<number>();
	for (let i = 0; i < count; i += 1) {
		picked.add(Math.round((i * (candidates.length - 1)) / (count - 1)));
	}
	return [...picked].sort((a, b) => a - b).map((i) => candidates[i] as Step);
}

export const SELECTOR_SYSTEM_PROMPT = [
	"You select evidence screenshots for an evaluator that judges a chatbot conversation.",
	"You receive the conversation transcript and the list of browser steps the simulated user took.",
	"Pick the steps whose screenshots best show whether the user's goal was reached and how the bot",
	"behaved: the first contact with the bot, each bot reply, downloads, errors and the final state.",
	"Return only step indexes from the list, most important first.",
].join("\n");

async function llmSelection(
	input: SelectEvidenceInput,
	model: BaseChatModel,
): Promise<{ steps: Step[] } | { fallback: string }> {
	const candidates = withScreenshot(input.steps);
	const byIndex = new Map(candidates.map((s) => [s.index, s]));
	try {
		const user = [
			`Select at most ${input.maxImages} steps.`,
			"",
			"## Transcript",
			formatTranscript(input.transcript),
			"",
			"## Steps with screenshots",
			formatStepList(candidates),
		].join("\n");
		const raw = await model
			.withStructuredOutput(SelectorOutputSchema)
			.invoke([new SystemMessage(SELECTOR_SYSTEM_PROMPT), new HumanMessage(user)]);
		const parsed = SelectorOutputSchema.safeParse(raw);
		if (!parsed.success)
			return { fallback: `selector returned an invalid shape: ${parsed.error.message}` };
		const chosen: Step[] = [];
		for (const index of parsed.data.steps) {
			const step = byIndex.get(index);
			if (!step || chosen.includes(step)) continue;
			chosen.push(step);
			if (chosen.length >= input.maxImages) break;
		}
		if (chosen.length === 0) return { fallback: "selector returned no usable step indexes" };
		return { steps: chosen.sort((a, b) => a.index - b.index) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { fallback: `selector failed: ${message}` };
	}
}

/** Chooses the screenshots to attach to the judge prompt. Never throws. */
export async function selectEvidence(input: SelectEvidenceInput): Promise<EvidenceSelection> {
	if (input.maxImages <= 0) return { steps: [], strategy: input.strategy };
	if (input.strategy === "llm") {
		if (!input.selectorModel) {
			return {
				steps: uniformSelection(input.steps, input.maxImages),
				strategy: "uniform",
				fallback: "no selector model configured",
			};
		}
		const result = await llmSelection(input, input.selectorModel);
		if ("steps" in result) return { steps: result.steps, strategy: "llm" };
		return {
			steps: uniformSelection(input.steps, input.maxImages),
			strategy: "uniform",
			fallback: result.fallback,
		};
	}
	return { steps: uniformSelection(input.steps, input.maxImages), strategy: "uniform" };
}
