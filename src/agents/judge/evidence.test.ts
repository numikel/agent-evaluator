import { describe, expect, it } from "vitest";
import type { Step } from "../../schemas/index.js";
import { ScriptedChatModel } from "../../testing/scripted-chat-model.js";
import { selectEvidence, uniformSelection } from "./evidence.js";
import { makeSteps, makeTranscript } from "./test-fixtures.js";

const manySteps = (n: number): Step[] =>
	Array.from({ length: n }, (_, i) => ({
		index: i + 1,
		turn: Math.ceil((i + 1) / 2),
		action: { kind: "snapshot" as const },
		screenshot: `steps/${String(i + 1).padStart(3, "0")}/after.png`,
		interim_screenshots: [],
	}));

const indexes = (steps: Step[]) => steps.map((s) => s.index);

describe("uniform selection (seam 3)", () => {
	it("respects maxImages and always includes the first and last screenshot", () => {
		const selected = uniformSelection(manySteps(20), 5);
		expect(selected).toHaveLength(5);
		expect(indexes(selected)[0]).toBe(1);
		expect(indexes(selected).at(-1)).toBe(20);
		expect(indexes(selected)).toEqual([...indexes(selected)].sort((a, b) => a - b));
	});

	it("skips steps without a screenshot", () => {
		const steps = makeSteps(); // step 6 (end_conversation) has no screenshot
		const selected = uniformSelection(steps, 10);
		expect(indexes(selected)).toEqual([1, 2, 3, 4, 5]);
	});

	it("returns every candidate when there are fewer than maxImages", () => {
		expect(indexes(uniformSelection(manySteps(3), 10))).toEqual([1, 2, 3]);
	});

	it("returns nothing for maxImages 0 and the last step for maxImages 1", () => {
		expect(uniformSelection(manySteps(4), 0)).toEqual([]);
		expect(indexes(uniformSelection(manySteps(4), 1))).toEqual([4]);
	});
});

describe("selectEvidence (seam 3 + 7)", () => {
	const transcript = makeTranscript();

	it("uniform strategy never calls the selector model", async () => {
		const selector = new ScriptedChatModel({ script: [], structured: [{ steps: [1] }] });
		const result = await selectEvidence({
			steps: manySteps(12),
			transcript,
			maxImages: 4,
			strategy: "uniform",
			selectorModel: selector,
		});
		expect(result.strategy).toBe("uniform");
		expect(result.steps).toHaveLength(4);
		expect(selector.callCount).toBe(0);
	});

	it("llm strategy parses the scripted {steps}, drops unknown indexes and clamps to maxImages", async () => {
		const selector = new ScriptedChatModel({
			script: [],
			structured: [{ steps: [9, 3, 42, 3, 7, 1, 11] }],
		});
		const result = await selectEvidence({
			steps: manySteps(12),
			transcript,
			maxImages: 4,
			strategy: "llm",
			selectorModel: selector,
		});
		expect(result.strategy).toBe("llm");
		expect(result.fallback).toBeUndefined();
		// Model order is respected for the cap, then the result is sorted by step for the prompt.
		expect(indexes(result.steps)).toEqual([3, 7, 9, 1].sort((a, b) => a - b));
		// The selector saw the transcript and the step list.
		const prompt = JSON.stringify(selector.calls[0]);
		expect(prompt).toContain("need my invoice for september as pdf");
		expect(prompt).toContain("step 12");
	});

	it("falls back to uniform when the selector throws", async () => {
		const selector = new ScriptedChatModel({ script: [], structured: [] }); // exhausted → throws
		const result = await selectEvidence({
			steps: manySteps(12),
			transcript,
			maxImages: 4,
			strategy: "llm",
			selectorModel: selector,
		});
		expect(result.strategy).toBe("uniform");
		expect(result.fallback).toMatch(/exhausted/);
		expect(result.steps).toHaveLength(4);
	});

	it("falls back to uniform when the selector returns no usable steps", async () => {
		const selector = new ScriptedChatModel({ script: [], structured: [{ steps: [99] }] });
		const result = await selectEvidence({
			steps: manySteps(6),
			transcript,
			maxImages: 3,
			strategy: "llm",
			selectorModel: selector,
		});
		expect(result.strategy).toBe("uniform");
		expect(result.steps).toHaveLength(3);
	});

	it("falls back to uniform when no selector model is given", async () => {
		const result = await selectEvidence({
			steps: manySteps(6),
			transcript,
			maxImages: 3,
			strategy: "llm",
		});
		expect(result.strategy).toBe("uniform");
	});

	it("does not call the selector when maxImages is 0", async () => {
		const selector = new ScriptedChatModel({ script: [], structured: [{ steps: [1] }] });
		const result = await selectEvidence({
			steps: manySteps(6),
			transcript,
			maxImages: 0,
			strategy: "llm",
			selectorModel: selector,
		});
		expect(result.steps).toEqual([]);
		expect(selector.callCount).toBe(0);
	});
});
