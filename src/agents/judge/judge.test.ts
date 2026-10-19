import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { type CriterionResult, VerdictSchema } from "../../schemas/index.js";
import { ScriptedChatModel } from "../../testing/scripted-chat-model.js";
import { judgeRun, type LlmCriterionOutput } from "./index.js";
import { makeJudgeInput, makeRun, templateResolved } from "./test-fixtures.js";

const NOW = new Date("2026-10-19T10:05:00.000Z");

/** Template rubric LLM criteria in rubric order: goal_reached, tone, no_hallucinated_data, stays_on_task. */
const happyJudgeOutputs = (): LlmCriterionOutput[] => [
	{
		score: 1,
		pass: true,
		reason: "PDF downloaded and confirmed as September.",
		evidence: [{ step: 4 }],
	},
	{ score: 4, pass: true, reason: "Polite and brief.", evidence: [] },
	{ score: 1, pass: true, reason: "No invented data.", evidence: [] },
	{ score: 5, pass: true, reason: "Stayed on task.", evidence: [] },
];

const judgeModel = (structured: unknown[]) => new ScriptedChatModel({ script: [], structured });
const selectorModel = (steps: number[]) =>
	new ScriptedChatModel({ script: [], structured: [{ steps }] });

/** Text block of the human message in a judge call (the composed user prompt). */
const promptTextOf = (messages: BaseMessage[] | undefined): string => {
	const human = messages?.find((m) => m.getType() === "human");
	if (!human || !Array.isArray(human.content)) throw new Error("expected a human message");
	const first = (human.content as Array<{ type: string; text?: string }>)[0];
	return String(first?.text ?? "");
};

const imageBlocks = (messages: BaseMessage[] | undefined) => {
	const human = messages?.find((m) => m.getType() === "human");
	if (!human || !Array.isArray(human.content)) return [];
	return (human.content as Array<{ type: string }>).filter((b) => b.type === "image");
};

describe("judgeRun — happy path", () => {
	it("produces a PASSED verdict with every criterion in rubric order", async () => {
		const input = await makeJudgeInput();
		const judge = judgeModel(happyJudgeOutputs());
		const seen: CriterionResult[] = [];
		const verdict = await judgeRun(input, {
			judgeModel: judge,
			selectorModel: selectorModel([2, 3, 4, 5]),
			now: () => NOW,
			onCriterion: (r) => {
				seen.push(r);
			},
		});

		expect(VerdictSchema.safeParse(verdict).success).toBe(true);
		expect(verdict.status).toBe("PASSED");
		expect(verdict.goal_reached).toBe(true);
		expect(verdict.runId).toBe(input.run.id);
		expect(verdict.pass_threshold).toBe(0.7);
		expect(verdict.turns_used).toBe(3);
		expect(verdict.max_turns).toBe(6);
		expect(verdict.judge_model).toBe("test:judge");
		expect(verdict.judged_at).toBe(NOW.toISOString());
		expect(verdict.goal_assessment).toBe("PDF downloaded and confirmed as September.");
		expect(verdict.summary).toContain("PASSED");
		expect(verdict.evidence_screenshots).toEqual([
			"steps/002/after.png",
			"steps/003/after.png",
			"steps/004/after.png",
			"steps/005/after.png",
		]);

		expect(verdict.criteria.map((c) => c.id)).toEqual(
			input.resolved.rubric.criteria.map((c) => c.id),
		);
		const byId = Object.fromEntries(verdict.criteria.map((c) => [c.id, c]));
		expect(byId.pdf_delivered).toMatchObject({ pass: true, score: 1, required: true });
		expect(byId.mentions_month).toMatchObject({ pass: true });
		expect(byId.fast_enough).toMatchObject({ pass: true, raw: { measured_ms: 2600 } });
		expect(byId.clean_console).toMatchObject({ pass: true, raw: { ignored: 1 } });
		expect(byId.tone?.score).toBe(0.8);
		// Σ weight·score / Σ weight = (3 + 0.8 + 2 + 1 + 2 + 0.5 + 0.5 + 0.5) / 10.5
		expect(verdict.score).toBeCloseTo(10.3 / 10.5, 6);

		// Live callback: deterministic criteria first, then LLM criteria in rubric order.
		expect(seen.map((r) => r.id)).toEqual([
			"pdf_delivered",
			"mentions_month",
			"fast_enough",
			"clean_console",
			"goal_reached",
			"tone",
			"no_hallucinated_data",
			"stays_on_task",
		]);

		// Every LLM call carried the four selected screenshots as image blocks.
		expect(judge.calls).toHaveLength(4);
		for (const call of judge.calls) expect(imageBlocks(call)).toHaveLength(4);
	});

	it("uses the judge model as selector when none is given", async () => {
		const input = await makeJudgeInput();
		const judge = judgeModel([{ steps: [3] }, ...happyJudgeOutputs()]);
		const verdict = await judgeRun(input, { judgeModel: judge, now: () => NOW });
		expect(verdict.status).toBe("PASSED");
		expect(verdict.evidence_screenshots).toEqual(["steps/003/after.png"]);
	});
});

describe("judgeRun — goal_reached overrides the simulator (seam 5)", () => {
	it("fails the run when the judge rejects the simulator's goal_reached claim", async () => {
		const input = await makeJudgeInput();
		expect(input.run.simulator_outcome?.reason).toBe("goal_reached");
		const outputs = happyJudgeOutputs();
		outputs[0] = {
			score: 0,
			pass: false,
			reason: "The bot only described the invoice; no September PDF was confirmed.",
			evidence: [{ turn: 2 }],
		};
		const judge = judgeModel(outputs);
		const verdict = await judgeRun(input, {
			judgeModel: judge,
			selectorModel: selectorModel([2, 5]),
			now: () => NOW,
		});
		expect(verdict.status).toBe("FAILED");
		expect(verdict.goal_reached).toBe(false);
		expect(verdict.goal_assessment).toMatch(/no September PDF/);
		expect(verdict.criteria).toHaveLength(8);
		expect(verdict.score).toBeGreaterThan(0);
		expect(verdict.summary).toContain("FAILED");

		const goalPrompt = promptTextOf(judge.calls[0]);
		expect(goalPrompt).toContain("3 of 6 turns");
		expect(goalPrompt).toContain("Downloaded the September invoice PDF.");
		expect(goalPrompt).toMatch(/your assessment overrides/i);
	});

	it("states max_turns exhaustion in the goal_reached prompt", async () => {
		const input = await makeJudgeInput({
			run: makeRun({
				turns_used: 6,
				simulator_outcome: { reason: "max_turns", summary: "Ran out of turns." },
			}),
		});
		const judge = judgeModel(happyJudgeOutputs());
		const verdict = await judgeRun(input, {
			judgeModel: judge,
			selectorModel: selectorModel([2]),
			now: () => NOW,
		});
		expect(verdict.turns_used).toBe(6);
		const goalPrompt = promptTextOf(judge.calls[0]);
		expect(goalPrompt).toMatch(/turn budget was exhausted/i);
	});
});

describe("judgeRun — required deterministic failure (seam 6)", () => {
	it("fails on pdf_delivered even though every LLM criterion passed, keeping score > 0", async () => {
		const input = await makeJudgeInput({ downloads: [] });
		const verdict = await judgeRun(input, {
			judgeModel: judgeModel(happyJudgeOutputs()),
			selectorModel: selectorModel([2]),
			now: () => NOW,
		});
		expect(verdict.status).toBe("FAILED");
		expect(verdict.goal_reached).toBe(true);
		expect(verdict.score).toBeGreaterThan(0);
		const pdf = verdict.criteria.find((c) => c.id === "pdf_delivered");
		expect(pdf).toMatchObject({ pass: false, score: 0, required: true });
		expect(verdict.summary).toMatch(/pdf_delivered/);
	});
});

describe("judgeRun — evidence selection (seam 7)", () => {
	it("falls back to uniform when the selector throws and still produces a verdict", async () => {
		const input = await makeJudgeInput();
		const judge = judgeModel(happyJudgeOutputs());
		const verdict = await judgeRun(input, {
			judgeModel: judge,
			selectorModel: new ScriptedChatModel({ script: [], structured: [] }),
			now: () => NOW,
		});
		expect(verdict.status).toBe("PASSED");
		// 5 steps have screenshots, max_images is 10 → all of them.
		expect(verdict.evidence_screenshots).toEqual([
			"steps/001/after.png",
			"steps/002/after.png",
			"steps/003/after.png",
			"steps/004/after.png",
			"steps/005/after.png",
		]);
		for (const call of judge.calls) expect(imageBlocks(call)).toHaveLength(5);
	});

	it("honours evidence_selection: uniform and max_images", async () => {
		const resolved = await templateResolved();
		resolved.evaluator = { ...resolved.evaluator, evidence_selection: "uniform", max_images: 2 };
		const input = await makeJudgeInput({ resolved });
		const selector = selectorModel([2]);
		const judge = judgeModel(happyJudgeOutputs());
		const verdict = await judgeRun(input, {
			judgeModel: judge,
			selectorModel: selector,
			now: () => NOW,
		});
		expect(selector.callCount).toBe(0);
		expect(verdict.evidence_screenshots).toEqual(["steps/001/after.png", "steps/005/after.png"]);
		for (const call of judge.calls) expect(imageBlocks(call)).toHaveLength(2);
	});

	it("drops screenshots that cannot be read", async () => {
		const input = await makeJudgeInput();
		const readFile = input.readFile;
		input.readFile = async (rel) => {
			if (rel === "steps/003/after.png") throw new Error("ENOENT");
			return readFile(rel);
		};
		const verdict = await judgeRun(input, {
			judgeModel: judgeModel(happyJudgeOutputs()),
			selectorModel: selectorModel([2, 3, 4]),
			now: () => NOW,
		});
		expect(verdict.evidence_screenshots).toEqual(["steps/002/after.png", "steps/004/after.png"]);
	});
});

describe("judgeRun — edge cases", () => {
	it("propagates judge model errors instead of fabricating a verdict", async () => {
		const input = await makeJudgeInput();
		await expect(
			judgeRun(input, {
				judgeModel: judgeModel([]),
				selectorModel: selectorModel([2]),
				now: () => NOW,
			}),
		).rejects.toThrow(/exhausted/);
	});

	it("takes goal_reached from an author-defined deterministic override", async () => {
		const resolved = await templateResolved();
		resolved.rubric = {
			...resolved.rubric,
			criteria: [
				{
					id: "goal_reached",
					type: "file",
					description: "A PDF was downloaded.",
					mime: "application/pdf",
					weight: 3,
					required: true,
				},
				{
					id: "tone",
					type: "llm",
					description: "Polite.",
					weight: 1,
					required: false,
					scale: "0-5",
				},
			],
		};
		const input = await makeJudgeInput({ resolved });
		const judge = judgeModel([{ score: 5, pass: true, reason: "ok", evidence: [] }]);
		const verdict = await judgeRun(input, {
			judgeModel: judge,
			selectorModel: selectorModel([2]),
			now: () => NOW,
		});
		expect(judge.calls).toHaveLength(1);
		expect(verdict.goal_reached).toBe(true);
		expect(verdict.status).toBe("PASSED");
		expect(verdict.goal_assessment).toMatch(/invoice-09.pdf/);
	});

	it("applies the built-in goal_reached when the rubric lacks it", async () => {
		const resolved = await templateResolved();
		resolved.rubric = {
			...resolved.rubric,
			criteria: resolved.rubric.criteria.filter((c) => c.id !== "goal_reached"),
		};
		const input = await makeJudgeInput({ resolved });
		const verdict = await judgeRun(input, {
			judgeModel: judgeModel(happyJudgeOutputs()),
			selectorModel: selectorModel([2]),
			now: () => NOW,
		});
		expect(verdict.criteria[0]?.id).toBe("goal_reached");
		expect(verdict.status).toBe("PASSED");
	});
});
