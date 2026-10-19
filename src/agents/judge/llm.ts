/**
 * Scores one `llm` criterion with the judge model.
 *
 * Design choice: `model.withStructuredOutput(schema)` instead of `createAgent({ responseFormat })`.
 * The judge call has no tools and needs exactly one round-trip, so an agent loop would only add a
 * graph, a tool-call hop for the structured output and middleware we do not use. `withStructuredOutput`
 * is the smallest primitive that gives validated JSON from every provider LangChain supports, and it
 * accepts the same `HumanMessage` content blocks (text + base64 images) as an agent would.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
	type CriterionResult,
	type EvidenceRef,
	EvidenceRefSchema,
	type Step,
} from "../../schemas/index.js";
import {
	type JudgePrompt,
	type LlmCriterion,
	LlmCriterionOutputSchema,
	normaliseScore,
} from "./prompt.js";
import type { JudgeInput } from "./types.js";

/** Base64 PNG content block in the v1 shape proven in P0 (`{ type, data, mimeType }`). */
export type ImageBlock = { type: "image"; data: string; mimeType: "image/png" };

export type LoadedScreenshots = {
	/** Steps whose screenshot was read successfully, in the given order. */
	steps: Step[];
	/** One block per step in `steps`. */
	images: ImageBlock[];
	/** `path: message` for each screenshot that could not be read. */
	errors: string[];
};

/** Reads the primary screenshot of each step; unreadable ones are dropped together with their step. */
export async function loadScreenshots(
	steps: Step[],
	readFile: JudgeInput["readFile"],
): Promise<LoadedScreenshots> {
	const out: LoadedScreenshots = { steps: [], images: [], errors: [] };
	for (const step of steps) {
		if (!step.screenshot) continue;
		try {
			const bytes = await readFile(step.screenshot);
			out.steps.push(step);
			out.images.push({
				type: "image",
				data: Buffer.from(bytes).toString("base64"),
				mimeType: "image/png",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			out.errors.push(`${step.screenshot}: ${message}`);
		}
	}
	return out;
}

export type ScoreLlmCriterionInput = {
	criterion: LlmCriterion;
	prompt: JudgePrompt;
	images: ImageBlock[];
	model: BaseChatModel;
};

/** Core fields are mandatory; evidence entries are validated one by one so a stray ref is dropped, not fatal. */
const LenientOutputSchema = LlmCriterionOutputSchema.extend({
	evidence: z.array(z.unknown()).default([]),
});

function sanitiseEvidence(entries: unknown[]): EvidenceRef[] {
	const refs: EvidenceRef[] = [];
	for (const entry of entries) {
		const parsed = EvidenceRefSchema.safeParse(entry);
		if (!parsed.success) continue;
		const ref: EvidenceRef = {};
		if (parsed.data.step !== undefined) ref.step = parsed.data.step;
		if (parsed.data.turn !== undefined) ref.turn = parsed.data.turn;
		if (parsed.data.quote !== undefined) ref.quote = parsed.data.quote;
		if (parsed.data.screenshot !== undefined) ref.screenshot = parsed.data.screenshot;
		if (Object.keys(ref).length > 0) refs.push(ref);
	}
	return refs;
}

/** One structured-output call; model errors propagate (an unscorable run is an ERROR, not a FAIL). */
export async function scoreLlmCriterion(input: ScoreLlmCriterionInput): Promise<CriterionResult> {
	const { criterion, prompt, images, model } = input;
	const messages = [
		new SystemMessage(prompt.system),
		new HumanMessage({ content: [{ type: "text", text: prompt.user }, ...images] }),
	];
	const raw = await model.withStructuredOutput(LlmCriterionOutputSchema).invoke(messages);
	const parsed = LenientOutputSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`judge returned invalid output for criterion "${criterion.id}": ${parsed.error.message}`,
		);
	}
	const { score, pass, reason, evidence } = parsed.data;
	return {
		id: criterion.id,
		score: normaliseScore(criterion.scale, score, pass),
		pass,
		weight: criterion.weight,
		required: criterion.required,
		reason: reason.trim(),
		evidence: sanitiseEvidence(evidence),
		raw: { score, scale: criterion.scale },
	};
}
