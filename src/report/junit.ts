import { overallStatus } from "./summary.js";
import { escapeXml, percent, secondsBetween } from "./text.js";
import type { ReportInput } from "./types.js";

type TestCase = {
	name: string;
	classname: string;
	time: string;
	failure?: { message: string; type: string; body: string };
	error?: { message: string; type: string; body: string };
	systemOut?: string;
};

/** Why the run as a whole failed, for the synthetic `run` testcase. */
export function runFailureReason(input: ReportInput): string {
	const { run, verdict } = input;
	const reasons: string[] = [];
	if (run.simulator_outcome?.reason === "max_turns") {
		reasons.push(`turn budget exhausted (${verdict.turns_used}/${verdict.max_turns})`);
	}
	if (!verdict.goal_reached) reasons.push("goal not reached");
	if (verdict.criteria.some((c) => c.required && !c.pass)) {
		reasons.push("a required criterion failed");
	}
	if (verdict.score < verdict.pass_threshold) {
		reasons.push(
			`score ${percent(verdict.score)}% below pass threshold ${percent(verdict.pass_threshold)}%`,
		);
	}
	return reasons.length > 0 ? reasons.join("; ") : "run marked FAILED";
}

function element(name: string, attrs: Record<string, string | number>, body?: string): string {
	const attrText = Object.entries(attrs)
		.map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
		.join("");
	return body === undefined ? `<${name}${attrText}/>` : `<${name}${attrText}>${body}</${name}>`;
}

function renderCase(tc: TestCase, indent: string): string {
	const children: string[] = [];
	if (tc.failure) {
		children.push(
			element(
				"failure",
				{ message: tc.failure.message, type: tc.failure.type },
				escapeXml(tc.failure.body),
			),
		);
	}
	if (tc.error) {
		children.push(
			element(
				"error",
				{ message: tc.error.message, type: tc.error.type },
				escapeXml(tc.error.body),
			),
		);
	}
	if (tc.systemOut) children.push(element("system-out", {}, escapeXml(tc.systemOut)));
	const attrs = { name: tc.name, classname: tc.classname, time: tc.time };
	if (children.length === 0) return `${indent}${element("testcase", attrs)}`;
	const inner = children.map((c) => `${indent}\t${c}`).join("\n");
	return `${indent}<testcase${Object.entries(attrs)
		.map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
		.join("")}>\n${inner}\n${indent}</testcase>`;
}

/**
 * `junit.xml`: `<testsuites>` → one `<testsuite name=scenario>` → one `<testcase>` per criterion.
 * Failed criteria carry `<failure message=reason>`. A FAILED run whose criteria all passed gets an
 * extra `run` testcase with a failure; an ERROR run gets a `run` testcase with `<error>`.
 */
export function renderJUnit(input: ReportInput): string {
	const { run, verdict } = input;
	const status = overallStatus(input);
	const classname = `${run.scenario}.${run.rubric}`;
	const cases: TestCase[] = verdict.criteria.map((c) => {
		const tc: TestCase = { name: c.id, classname, time: "0.000" };
		const detail = [
			`score: ${percent(c.score)}%`,
			`weight: ${c.weight}`,
			`required: ${c.required}`,
			`reason: ${c.reason}`,
		].join("\n");
		if (c.pass) tc.systemOut = detail;
		else tc.failure = { message: c.reason, type: "CriterionFailed", body: detail };
		return tc;
	});

	let failures = cases.filter((c) => c.failure).length;
	let errors = 0;
	if (status === "ERROR") {
		const message = run.error ?? "run errored";
		cases.push({
			name: "run",
			classname,
			time: secondsBetween(run.started_at, run.finished_at),
			error: { message, type: "RunError", body: message },
		});
		errors = 1;
	} else if (status === "FAILED" && failures === 0) {
		const message = runFailureReason(input);
		cases.push({
			name: "run",
			classname,
			time: secondsBetween(run.started_at, run.finished_at),
			failure: { message, type: "RunFailed", body: message },
		});
		failures = 1;
	}

	const properties: Record<string, string | number> = {
		runId: run.id,
		status,
		scenario: run.scenario,
		persona: run.persona,
		target: run.target,
		rubric: run.rubric,
		score: verdict.score,
		percent: percent(verdict.score),
		pass_threshold: verdict.pass_threshold,
		goal_reached: String(verdict.goal_reached),
		turns_used: verdict.turns_used,
		max_turns: verdict.max_turns,
		simulator_model: run.models.simulator,
		judge_model: run.models.judge,
	};
	const propertyLines = Object.entries(properties)
		.map(([name, value]) => `\t\t\t${element("property", { name, value })}`)
		.join("\n");

	const suiteAttrs = {
		name: run.scenario,
		tests: cases.length,
		failures,
		errors,
		skipped: 0,
		timestamp: run.started_at,
		time: secondsBetween(run.started_at, run.finished_at),
	};
	const rootAttrs = {
		name: "agent-evaluator",
		tests: cases.length,
		failures,
		errors,
		time: suiteAttrs.time,
	};
	const attrText = (attrs: Record<string, string | number>) =>
		Object.entries(attrs)
			.map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
			.join("");

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<testsuites${attrText(rootAttrs)}>`,
		`\t<testsuite${attrText(suiteAttrs)}>`,
		"\t\t<properties>",
		propertyLines,
		"\t\t</properties>",
		...cases.map((tc) => renderCase(tc, "\t\t")),
		`\t\t${element("system-out", {}, escapeXml(verdict.summary))}`,
		"\t</testsuite>",
		"</testsuites>",
		"",
	].join("\n");
}
