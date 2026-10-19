import { describe, expect, it } from "vitest";
import { failedMaxTurnsFixture, passedFixture } from "./fixtures/index.js";
import { renderSummary } from "./summary.js";

describe("renderSummary", () => {
	it("reports the percentage as round(score * 100) with the verdict essentials", () => {
		const summary = renderSummary(passedFixture());
		expect(summary).toMatchObject({
			runId: "20261019-091402-invoice-export-september",
			scenario: "invoice-export-september",
			status: "PASSED",
			score: 0.9619047619047619,
			percent: 96,
			pass_threshold: 0.7,
			goal_reached: true,
			turns_used: 3,
			max_turns: 6,
			started_at: "2026-10-19T09:14:02.000Z",
			finished_at: "2026-10-19T09:15:41.000Z",
		});
		expect(summary.criteria).toEqual([
			{ id: "goal_reached", score: 1, pass: true, required: true },
			{ id: "tone", score: 0.8, pass: true, required: false },
			{ id: "no_hallucinated_data", score: 1, pass: true, required: true },
			{ id: "stays_on_task", score: 0.8, pass: true, required: false },
			{ id: "pdf_delivered", score: 1, pass: true, required: true },
			{ id: "mentions_month", score: 1, pass: true, required: false },
			{ id: "fast_enough", score: 1, pass: true, required: false },
			{ id: "clean_console", score: 1, pass: true, required: false },
		]);
	});

	it("keeps the full criteria breakdown for a FAILED run", () => {
		const summary = renderSummary(failedMaxTurnsFixture());
		expect(summary.status).toBe("FAILED");
		expect(summary.percent).toBe(33);
		expect(summary.goal_reached).toBe(false);
		expect(summary.turns_used).toBe(summary.max_turns);
		expect(summary.criteria).toHaveLength(8);
		expect(summary.criteria.filter((c) => !c.pass).map((c) => c.id)).toEqual([
			"goal_reached",
			"stays_on_task",
			"pdf_delivered",
			"fast_enough",
			"clean_console",
		]);
	});

	it("surfaces a run that errored before judging as ERROR and omits a missing finished_at", () => {
		const input = passedFixture();
		input.run.status = "ERROR";
		input.run.error = "browser crashed";
		input.run.finished_at = undefined;
		const summary = renderSummary(input);
		expect(summary.status).toBe("ERROR");
		expect("finished_at" in summary).toBe(false);
	});

	it("rounds the percentage to a whole number", () => {
		const input = passedFixture();
		input.verdict.score = 0.666;
		expect(renderSummary(input).percent).toBe(67);
		input.verdict.score = 1;
		expect(renderSummary(input).percent).toBe(100);
	});
});
