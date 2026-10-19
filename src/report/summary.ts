import { percent } from "./text.js";
import type { ReportInput, ReportSummary } from "./types.js";

/** Overall status: the judge's verdict, unless the run errored out before/while judging. */
export function overallStatus(input: ReportInput): ReportSummary["status"] {
	return input.run.status === "ERROR" ? "ERROR" : input.verdict.status;
}

/** `summary.json` content as an object (stringify with `JSON.stringify(…, null, 2)`). */
export function renderSummary(input: ReportInput): ReportSummary {
	const { run, verdict } = input;
	const summary: ReportSummary = {
		runId: run.id,
		scenario: run.scenario,
		status: overallStatus(input),
		score: verdict.score,
		percent: percent(verdict.score),
		pass_threshold: verdict.pass_threshold,
		goal_reached: verdict.goal_reached,
		turns_used: verdict.turns_used,
		max_turns: verdict.max_turns,
		criteria: verdict.criteria.map((c) => ({
			id: c.id,
			score: c.score,
			pass: c.pass,
			required: c.required,
		})),
		started_at: run.started_at,
	};
	if (run.finished_at !== undefined) summary.finished_at = run.finished_at;
	return summary;
}
