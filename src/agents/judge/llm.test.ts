import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { ScriptedChatModel } from "../../testing/scripted-chat-model.js";
import { loadScreenshots, scoreLlmCriterion } from "./llm.js";
import { buildJudgePrompt, type LlmCriterion } from "./prompt.js";
import {
	makeConsole,
	makeRun,
	makeSteps,
	makeTranscript,
	memoryReadFile,
	PNG_1X1,
	templateResolved,
} from "./test-fixtures.js";

async function setup(criterionId: string) {
	const resolved = await templateResolved();
	const criterion = resolved.rubric.criteria.find((c) => c.id === criterionId) as LlmCriterion;
	const steps = makeSteps().slice(1, 3); // steps 2 and 3, both with screenshots
	const loaded = await loadScreenshots(steps, memoryReadFile());
	const prompt = buildJudgePrompt({
		run: makeRun(),
		resolved,
		criterion,
		transcript: makeTranscript(),
		files: [],
		console: makeConsole(),
		screenshots: loaded.steps,
	});
	return { criterion, prompt, images: loaded.images };
}

const contentOf = (m: BaseMessage | undefined) => {
	if (!m || !Array.isArray(m.content)) throw new Error("expected array content");
	return m.content as Array<Record<string, unknown>>;
};

describe("scoreLlmCriterion (seam 4)", () => {
	it("normalises a 0-5 score to 0.8 and sends principles, criterion and image blocks", async () => {
		const { criterion, prompt, images } = await setup("tone");
		const model = new ScriptedChatModel({
			script: [],
			structured: [
				{
					score: 4,
					pass: true,
					reason: "Polite and brief.",
					evidence: [{ step: 3, quote: "Sure" }],
				},
			],
		});
		const result = await scoreLlmCriterion({ criterion, prompt, images, model });
		expect(result).toMatchObject({
			id: "tone",
			score: 0.8,
			pass: true,
			weight: 1,
			required: false,
			reason: "Polite and brief.",
		});
		expect(result.evidence).toEqual([{ step: 3, quote: "Sure" }]);
		expect(result.raw).toMatchObject({ score: 4, scale: "0-5" });

		const call = model.calls[0];
		expect(call).toBeDefined();
		const [system, human] = call ?? [];
		expect(system?.getType()).toBe("system");
		expect(String(system?.content)).toContain("## Principles");
		expect(String(system?.content)).toContain("evaluation steps");
		expect(human?.getType()).toBe("human");
		const blocks = contentOf(human);
		expect(blocks[0]).toMatchObject({ type: "text" });
		expect(String(blocks[0]?.text)).toContain("## Criterion to score: tone");
		expect(String(blocks[0]?.text)).toContain("2 screenshot(s) attached");
		expect(blocks.slice(1)).toEqual([
			{ type: "image", data: Buffer.from(PNG_1X1).toString("base64"), mimeType: "image/png" },
			{ type: "image", data: Buffer.from(PNG_1X1).toString("base64"), mimeType: "image/png" },
		]);
	});

	it("binary scale follows pass and drops invalid evidence refs", async () => {
		const { criterion, prompt, images } = await setup("goal_reached");
		const model = new ScriptedChatModel({
			script: [],
			structured: [
				{
					score: 1,
					pass: false,
					reason: "No PDF was actually downloaded.",
					evidence: [{ step: -1 }, { turn: 2, quote: "Click Download" }, "junk"],
				},
			],
		});
		const result = await scoreLlmCriterion({ criterion, prompt, images, model });
		expect(result.score).toBe(0);
		expect(result.pass).toBe(false);
		expect(result.required).toBe(true);
		expect(result.weight).toBe(3);
		expect(result.evidence).toEqual([{ turn: 2, quote: "Click Download" }]);
	});

	it("rejects when the model returns an unusable shape", async () => {
		const { criterion, prompt, images } = await setup("tone");
		const model = new ScriptedChatModel({ script: [], structured: [{ nope: true }] });
		await expect(scoreLlmCriterion({ criterion, prompt, images, model })).rejects.toThrow(
			/invalid/i,
		);
	});

	it("propagates model errors", async () => {
		const { criterion, prompt, images } = await setup("tone");
		const model = new ScriptedChatModel({ script: [], structured: [] });
		await expect(scoreLlmCriterion({ criterion, prompt, images, model })).rejects.toThrow(
			/exhausted/,
		);
	});
});

describe("loadScreenshots", () => {
	it("drops steps whose screenshot cannot be read and keeps the rest aligned", async () => {
		const steps = makeSteps().slice(0, 3);
		const readFile = async (rel: string) => {
			if (rel === "steps/002/after.png") throw new Error("ENOENT");
			return PNG_1X1;
		};
		const loaded = await loadScreenshots(steps, readFile);
		expect(loaded.steps.map((s) => s.index)).toEqual([1, 3]);
		expect(loaded.images).toHaveLength(2);
		expect(loaded.errors[0]).toMatch(/steps\/002\/after.png.*ENOENT/);
	});
});
