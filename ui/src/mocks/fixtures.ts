/**
 * Fixture data for the mock API, built from the shipped templates so the UI mocks never drift
 * from what the real workspace loader accepts. Everything is parsed through the shared zod
 * schemas, so defaults are applied exactly as the server would.
 */
import type {
	PersonaDocument,
	ProviderModelsResponse,
	ProviderStatus,
	ResourceSummary,
	RunDetail,
	WorkspaceOverview,
} from "@schemas/api";
import {
	EvaluatorConfigSchema,
	RubricSchema,
	ScenarioSchema,
	SettingsSchema,
	TargetSchema,
} from "@schemas/api";
import type { EvaluatorConfig } from "@schemas/evaluator";
import { PersonaFrontmatterSchema } from "@schemas/persona";
import type { CriterionResult, RunEvent, RunRecord, RunSummary, Verdict } from "@schemas/run";
import { computeOutcome } from "@schemas/run";
import { parse as parseYaml } from "yaml";
import settingsYaml from "../../../templates/agent-evaluator.yaml?raw";
import evaluatorYaml from "../../../templates/evaluator.yaml?raw";
import personaMarkdown from "../../../templates/PERSONA.md?raw";
import rubricYaml from "../../../templates/rubric.yaml?raw";
import scenarioYaml from "../../../templates/scenario.yaml?raw";
import targetYaml from "../../../templates/target.yaml?raw";

export const templates = {
	persona: personaMarkdown,
	scenario: scenarioYaml,
	rubric: rubricYaml,
	target: targetYaml,
	evaluator: evaluatorYaml,
	settings: settingsYaml,
} as const;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Splits a persona Markdown file into YAML frontmatter and body (mirrors the workspace loader). */
export function splitFrontmatter(markdown: string): { frontmatter: unknown; body: string } {
	const match = FRONTMATTER.exec(markdown);
	if (!match) return { frontmatter: undefined, body: markdown };
	return { frontmatter: parseYaml(match[1] ?? ""), body: match[2] ?? "" };
}

const personaParts = splitFrontmatter(personaMarkdown);
export const persona: PersonaDocument = {
	frontmatter: PersonaFrontmatterSchema.parse(personaParts.frontmatter),
	body: personaParts.body,
};
export const scenario = ScenarioSchema.parse(parseYaml(scenarioYaml));
export const rubric = RubricSchema.parse(parseYaml(rubricYaml));
export const target = TargetSchema.parse(parseYaml(targetYaml));
export const evaluator: EvaluatorConfig = EvaluatorConfigSchema.parse(parseYaml(evaluatorYaml));
export const settings = SettingsSchema.parse(parseYaml(settingsYaml));

const UPDATED_AT = "2026-10-19T09:30:00.000Z";

export const summaries: Record<
	"personas" | "scenarios" | "rubrics" | "targets",
	ResourceSummary[]
> = {
	personas: [
		{
			name: persona.frontmatter.name,
			description: persona.frontmatter.description,
			path: `personas/${persona.frontmatter.name}.md`,
			updated_at: UPDATED_AT,
		},
	],
	scenarios: [
		{
			name: scenario.name,
			description: scenario.description,
			path: `scenarios/${scenario.name}.yaml`,
			updated_at: UPDATED_AT,
		},
	],
	rubrics: [
		{
			name: rubric.name,
			description: rubric.description,
			path: `rubrics/${rubric.name}.yaml`,
			updated_at: UPDATED_AT,
		},
	],
	targets: [
		{
			name: target.name,
			description: target.description,
			path: `targets/${target.name}.yaml`,
			updated_at: UPDATED_AT,
		},
	],
};

export const workspace: WorkspaceOverview = {
	root: "/home/me/evals",
	...summaries,
	has_evaluator: true,
	has_settings: true,
};

/** Providers are derived from the settings template so no model identifiers live in this file. */
function splitRef(ref: string): { provider: string; model: string } {
	const idx = ref.indexOf(":");
	return { provider: ref.slice(0, idx), model: ref.slice(idx + 1) };
}

const configuredProvider = splitRef(settings.models.simulator).provider;

export const providers: ProviderStatus[] = [
	{
		id: configuredProvider,
		label: configuredProvider,
		env: `${configuredProvider.toUpperCase().replace(/-/g, "_")}_API_KEY`,
		configured: true,
	},
	{ id: "ollama", label: "ollama", env: "OLLAMA_HOST", configured: true },
];

export function providerModels(providerId: string): ProviderModelsResponse {
	const fromSettings = [settings.models.simulator, settings.models.judge]
		.map(splitRef)
		.filter((r) => r.provider === providerId)
		.map((r) => r.model);
	const ids = [...new Set([...fromSettings, "mock-small", "mock-large"])];
	return {
		provider: providerId,
		models: ids.map((id) => ({
			provider: providerId,
			id,
			label: id,
			ref: `${providerId}:${id}`,
			context_window: 200_000,
			max_output_tokens: 16_384,
			supports_reasoning: true,
			supports_images: true,
			supports_tools: true,
		})),
		fetched_at: UPDATED_AT,
		source: providerId === "ollama" ? "fallback" : "api",
	};
}

/* ---------- runs ---------- */

const models = { simulator: settings.models.simulator, judge: settings.models.judge };

function criterionResults(): CriterionResult[] {
	return rubric.criteria.map((c, i) => {
		const score = i % 3 === 1 ? 0.6 : 1;
		return {
			id: c.id,
			score,
			pass: score >= 0.5,
			weight: c.weight,
			required: c.required,
			reason: `Mock assessment of "${c.id}".`,
			evidence: [{ step: i + 1, turn: 1, screenshot: `steps/00${i + 1}/after.png` }],
		};
	});
}

const passedCriteria = criterionResults();
const passedOutcome = computeOutcome({
	criteria: passedCriteria,
	goalReached: true,
	passThreshold: rubric.pass_threshold,
});

export const PASSED_RUN_ID = "20261019-100000-invoice-export-september-1";
export const RUNNING_RUN_ID = "20261019-103000-invoice-export-september-1";
export const FAILED_RUN_ID = "20261018-154500-invoice-export-september-1";

export const verdict: Verdict = {
	runId: PASSED_RUN_ID,
	status: passedOutcome.status,
	goal_reached: true,
	score: passedOutcome.score,
	pass_threshold: rubric.pass_threshold,
	turns_used: 4,
	max_turns: scenario.max_turns,
	criteria: passedCriteria,
	summary: "The bot produced the September invoice as a PDF on the fourth turn.",
	goal_assessment: "A PDF download was observed and confirmed as the September invoice.",
	judged_at: "2026-10-19T10:04:12.000Z",
	judge_model: models.judge,
	evidence_screenshots: ["steps/003/after.png", "steps/004/after.png"],
};

const baseRun = {
	scenario: scenario.name,
	persona: scenario.persona,
	target: scenario.target,
	rubric: rubric.name,
	repeat_index: 1,
	repeat_total: 1,
	max_turns: scenario.max_turns,
	models,
};

export const runs: RunRecord[] = [
	{
		...baseRun,
		id: RUNNING_RUN_ID,
		status: "RUNNING",
		started_at: "2026-10-19T10:30:00.000Z",
		turns_used: 2,
	},
	{
		...baseRun,
		id: PASSED_RUN_ID,
		status: "PASSED",
		started_at: "2026-10-19T10:00:00.000Z",
		finished_at: "2026-10-19T10:04:12.000Z",
		turns_used: 4,
		simulator_outcome: { reason: "goal_reached", summary: "Got the PDF." },
		score: verdict.score,
	},
	{
		...baseRun,
		id: FAILED_RUN_ID,
		status: "FAILED",
		started_at: "2026-10-18T15:45:00.000Z",
		finished_at: "2026-10-18T15:51:40.000Z",
		turns_used: 6,
		simulator_outcome: { reason: "max_turns", summary: "Kept being redirected to email support." },
		score: 0.42,
	},
];

export function toSummary(run: RunRecord): RunSummary {
	const summary: RunSummary = {
		id: run.id,
		scenario: run.scenario,
		persona: run.persona,
		target: run.target,
		status: run.status,
		started_at: run.started_at,
		turns_used: run.turns_used,
		max_turns: run.max_turns,
		repeat_index: run.repeat_index,
		repeat_total: run.repeat_total,
	};
	if (run.finished_at !== undefined) summary.finished_at = run.finished_at;
	if (run.score !== undefined) summary.score = run.score;
	return summary;
}

export function runDetail(id: string): RunDetail | undefined {
	const run = runs.find((r) => r.id === id);
	if (!run) return undefined;
	const detail: RunDetail = { run, has_report: run.status === "PASSED" || run.status === "FAILED" };
	if (run.id === PASSED_RUN_ID) detail.verdict = verdict;
	return detail;
}

/** A short, realistic event stream for the running fixture. */
export function runEvents(runId: string): RunEvent[] {
	const run = runs.find((r) => r.id === runId) ?? runs[0];
	if (!run) return [];
	const at = (s: number) => new Date(Date.parse(run.started_at) + s * 1000).toISOString();
	return [
		{ type: "run_started", runId, at: at(0), run },
		{ type: "status", runId, at: at(1), status: "RUNNING" },
		{
			type: "step",
			runId,
			at: at(2),
			step: {
				index: 1,
				turn: 0,
				action: { kind: "open", url: target.url },
				interim_screenshots: [],
				screenshot: "steps/001/after.png",
			},
		},
		{ type: "turn", runId, at: at(3), turn: 1, max_turns: run.max_turns },
		{
			type: "message",
			runId,
			at: at(4),
			entry: { turn: 1, role: "user", text: "need my invoice for september as pdf", at: at(4) },
		},
		{
			type: "message",
			runId,
			at: at(9),
			entry: {
				turn: 1,
				role: "bot",
				text: "Sure. Which customer number?",
				at: at(9),
				latency_ms: 4200,
			},
		},
		{ type: "log", runId, at: at(10), level: "info", message: "waiting for reply to settle" },
	];
}

export const reportHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report ${PASSED_RUN_ID}</title></head><body><h1>${scenario.name}</h1><p>Score ${Math.round(verdict.score * 100)}% — ${verdict.status}</p></body></html>`;
