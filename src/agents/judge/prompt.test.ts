import { describe, expect, it } from "vitest";
import type { Criterion } from "../../schemas/index.js";
import {
	buildJudgePrompt,
	formatStepList,
	formatTranscript,
	type JudgePromptInput,
	LlmCriterionOutputSchema,
	normaliseScore,
} from "./prompt.js";
import {
	makeConsole,
	makeDownloads,
	makeRun,
	makeSteps,
	makeTranscript,
	templateResolved,
} from "./test-fixtures.js";
import type { ExtractedFile } from "./types.js";

type LlmCriterion = Extract<Criterion, { type: "llm" }>;

async function promptInput(
	criterionId: string,
	overrides: Partial<JudgePromptInput> = {},
): Promise<JudgePromptInput> {
	const resolved = await templateResolved();
	const criterion = resolved.rubric.criteria.find((c) => c.id === criterionId);
	if (criterion?.type !== "llm") throw new Error(`no llm criterion ${criterionId}`);
	const files: ExtractedFile[] = [
		{
			...(makeDownloads()[0] as ExtractedFile),
			text: "Invoice INV-2026-09 September 2026 total 120.00",
		},
	];
	return {
		run: makeRun(),
		resolved,
		criterion,
		transcript: makeTranscript(),
		files,
		console: makeConsole(),
		screenshots: makeSteps()
			.filter((s) => s.screenshot)
			.slice(0, 3),
		...overrides,
	};
}

const render = (p: { system: string; user: string }) =>
	`# System prompt\n\n${p.system}\n\n# User message\n\n${p.user}\n`;

describe("buildJudgePrompt (D8 composition)", () => {
	it("matches the snapshot for the template scenario, criterion `tone`", async () => {
		const prompt = buildJudgePrompt(await promptInput("tone"));
		await expect(render(prompt)).toMatchFileSnapshot("__snapshots__/judge-prompt-tone.md");
	});

	it("matches the snapshot for the built-in `goal_reached` criterion", async () => {
		const prompt = buildJudgePrompt(await promptInput("goal_reached"));
		await expect(render(prompt)).toMatchFileSnapshot("__snapshots__/judge-prompt-goal-reached.md");
	});

	it("contains every D8 input", async () => {
		const input = await promptInput("tone");
		const { system, user } = buildJudgePrompt(input);
		const all = `${system}\n${user}`;
		const { scenario, persona, target, evaluator } = input.resolved;
		// principles + judge instructions
		expect(system).toContain(evaluator.principles.trim().split("\n")[0]);
		// scenario
		for (const text of [
			scenario.goal,
			scenario.intent,
			scenario.context,
			scenario.success_criteria,
		]) {
			expect(all).toContain((text ?? "").trim());
		}
		expect(all).toContain("max_turns: 6");
		expect(all).toContain("turns_used: 3");
		// persona summary + target hints
		expect(all).toContain(persona.frontmatter.description);
		expect(all).toContain(target.hints[0] ?? "");
		// criterion
		expect(all).toContain(input.criterion.description.trim());
		expect(all).toContain("scale: 0-5");
		expect(all).toContain("Warm, concise, adapted to the user's tone.");
		// transcript, files, console
		for (const entry of input.transcript) expect(all).toContain(entry.text);
		expect(all).toContain("INV-2026-09");
		expect(all).toContain("favicon.ico");
		// screenshots are listed with step and turn
		expect(all).toContain("3 screenshot(s) attached");
		expect(all).toContain("steps/002/after.png");
		// G-Eval
		expect(all).toMatch(/evaluation steps/i);
	});

	it("appends judge_instructions when configured", async () => {
		const input = await promptInput("tone");
		input.resolved = {
			...input.resolved,
			evaluator: { ...input.resolved.evaluator, judge_instructions: "Penalise emoji." },
		};
		expect(buildJudgePrompt(input).system).toContain("Penalise emoji.");
	});

	it("goal_reached receives the turn budget, the simulator claim and the override rule", async () => {
		const { user } = buildJudgePrompt(await promptInput("goal_reached"));
		expect(user).toContain("3 of 6 turns");
		expect(user).toContain("goal_reached");
		expect(user).toContain("Downloaded the September invoice PDF.");
		expect(user).toMatch(/your assessment overrides/i);
		expect(user).not.toMatch(/turn budget was exhausted/i);
	});

	it("goal_reached states max_turns exhaustion", async () => {
		const run = makeRun({
			turns_used: 6,
			simulator_outcome: { reason: "max_turns", summary: "Ran out of turns." },
		});
		const { user } = buildJudgePrompt(await promptInput("goal_reached", { run }));
		expect(user).toMatch(/turn budget was exhausted/i);
		expect(user).toContain("6 of 6 turns");
	});

	it("a non-goal criterion does not carry the simulator claim block", async () => {
		const { user } = buildJudgePrompt(await promptInput("tone"));
		expect(user).not.toMatch(/your assessment overrides/i);
	});

	it("copes with no screenshots, files or console errors", async () => {
		const { user } = buildJudgePrompt(
			await promptInput("tone", { screenshots: [], files: [], console: [] }),
		);
		expect(user).toContain("0 screenshot(s) attached");
		expect(user).toMatch(/no files were downloaded/i);
		expect(user).toMatch(/no console errors/i);
	});
});

describe("formatters", () => {
	it("formatTranscript renders turn, role and latency", () => {
		const text = formatTranscript(makeTranscript());
		expect(text).toContain("[turn 1] user: need my invoice for september as pdf");
		expect(text).toContain("[turn 1] bot (1200 ms): Sure. What is your customer number?");
	});

	it("formatStepList renders step, turn, action and screenshot path", () => {
		const text = formatStepList(makeSteps());
		expect(text).toContain('step 2 (turn 1): send_message "need my invoice for september as pdf"');
		expect(text).toContain("step 4 (turn 2): download ref=e12 — steps/004/after.png");
		expect(text).toContain("step 6 (turn 3): end_conversation goal_reached");
	});
});

describe("normaliseScore", () => {
	const scale = (s: LlmCriterion["scale"]) => s;
	it("binary follows pass", () => {
		expect(normaliseScore(scale("binary"), 1, true)).toBe(1);
		expect(normaliseScore(scale("binary"), 5, false)).toBe(0);
	});
	it("0-5 divides by five and clamps", () => {
		expect(normaliseScore(scale("0-5"), 4, true)).toBe(0.8);
		expect(normaliseScore(scale("0-5"), 7, true)).toBe(1);
		expect(normaliseScore(scale("0-5"), -1, false)).toBe(0);
	});
	it("0-1 is kept, clamped", () => {
		expect(normaliseScore(scale("0-1"), 0.35, false)).toBe(0.35);
		expect(normaliseScore(scale("0-1"), 1.5, true)).toBe(1);
	});
	it("non-finite scores fall back to the pass flag", () => {
		expect(normaliseScore(scale("0-5"), Number.NaN, true)).toBe(1);
		expect(normaliseScore(scale("0-5"), Number.NaN, false)).toBe(0);
	});
});

describe("LlmCriterionOutputSchema", () => {
	it("defaults evidence to [] and accepts partial refs", () => {
		const parsed = LlmCriterionOutputSchema.parse({ score: 4, pass: true, reason: "ok" });
		expect(parsed.evidence).toEqual([]);
		const withRefs = LlmCriterionOutputSchema.parse({
			score: 1,
			pass: true,
			reason: "ok",
			evidence: [{ step: 3 }, { turn: 2, quote: "q" }],
		});
		expect(withRefs.evidence).toHaveLength(2);
	});
});
