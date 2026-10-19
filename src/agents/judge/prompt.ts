/**
 * Prompt composition for LLM criteria (decision D8): a pure function of the run artifacts, so the
 * exact text a judge model sees is snapshot-tested. Screenshots are attached separately as image
 * blocks; the prompt lists them so the model can map image N to a step.
 */
import { z } from "zod";
import type {
	Action,
	ConsoleEntry,
	Criterion,
	RunRecord,
	Step,
	TranscriptEntry,
} from "../../schemas/index.js";
import { GOAL_REACHED_CRITERION_ID } from "../../schemas/index.js";
import type { ResolvedScenario } from "../../workspace/types.js";
import type { ExtractedFile } from "./types.js";

export type LlmCriterion = Extract<Criterion, { type: "llm" }>;

/** Structured output every LLM criterion call must produce. */
export const LlmCriterionOutputSchema = z.object({
	/** Score on the criterion's own scale (0/1 for binary, 0..5 for 0-5, 0..1 for 0-1). */
	score: z.number().describe("Score on the criterion's scale"),
	pass: z.boolean().describe("Whether the criterion is satisfied"),
	reason: z.string().describe("Concise justification grounded in the evidence"),
	evidence: z
		.array(
			z.object({
				step: z.number().int().positive().optional().describe("Step index"),
				turn: z.number().int().nonnegative().optional().describe("Conversation turn"),
				quote: z.string().optional().describe("Short quote from the transcript or a file"),
			}),
		)
		.default([])
		.describe("References to the evidence that supports the reason"),
});
export type LlmCriterionOutput = z.output<typeof LlmCriterionOutputSchema>;

export type JudgePromptInput = {
	run: RunRecord;
	resolved: ResolvedScenario;
	criterion: LlmCriterion;
	transcript: TranscriptEntry[];
	files: ExtractedFile[];
	console: ConsoleEntry[];
	/** Steps whose primary screenshot is attached as an image block, in attachment order. */
	screenshots: Step[];
};

export type JudgePrompt = { system: string; user: string };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Normalises a model score to 0..1 for the given scale; binary follows the `pass` flag. */
export function normaliseScore(scale: LlmCriterion["scale"], score: number, pass: boolean): number {
	if (scale === "binary" || !Number.isFinite(score)) return pass ? 1 : 0;
	return round4(clamp01(scale === "0-5" ? score / 5 : score));
}

const trim = (s: string | undefined) => (s ?? "").trim();

export function describeAction(action: Action): string {
	switch (action.kind) {
		case "open":
			return `open ${action.url}`;
		case "snapshot":
		case "read_conversation":
		case "screenshot_view":
			return action.kind;
		case "click":
			return `click ref=${action.ref}`;
		case "type":
			return `type ref=${action.ref} ${JSON.stringify(action.text)}${action.submit ? " (submit)" : ""}`;
		case "press":
			return `press ${action.key}`;
		case "scroll":
			return `scroll ${action.direction} ${action.amount}`;
		case "wait":
			return `wait ${action.ms} ms`;
		case "send_message":
			return `send_message ${JSON.stringify(action.text)}`;
		case "download":
			return `download ref=${action.ref}`;
		case "upload":
			return `upload ref=${action.ref} file=${action.file}`;
		case "click_at":
			return `click_at (${action.x}, ${action.y})`;
		case "type_at":
			return `type_at (${action.x}, ${action.y}) ${JSON.stringify(action.text)}`;
		case "end_conversation":
			return `end_conversation ${action.reason}: ${action.summary}`;
	}
}

/** `[turn N] role (latency ms): text`, one entry per line. */
export function formatTranscript(transcript: TranscriptEntry[]): string {
	if (transcript.length === 0)
		return "(empty transcript — the simulated user never sent a message)";
	return transcript
		.map((e) => {
			const latency = e.role === "bot" && e.latency_ms !== undefined ? ` (${e.latency_ms} ms)` : "";
			return `[turn ${e.turn}] ${e.role}${latency}: ${e.text.replace(/\r?\n/g, "\n    ")}`;
		})
		.join("\n");
}

/** `step N (turn T): action — screenshot`, one step per line. */
export function formatStepList(steps: Step[]): string {
	if (steps.length === 0) return "(no steps recorded)";
	return steps
		.map((s) => {
			const shot = s.screenshot ? ` — ${s.screenshot}` : "";
			const err = s.error ? ` [error: ${s.error}]` : "";
			return `step ${s.index} (turn ${s.turn}): ${describeAction(s.action)}${shot}${err}`;
		})
		.join("\n");
}

function formatFiles(files: ExtractedFile[]): string {
	if (files.length === 0) return "No files were downloaded during the conversation.";
	return files
		.map((f) => {
			const where = [
				f.step !== undefined ? `step ${f.step}` : "",
				f.turn !== undefined ? `turn ${f.turn}` : "",
			]
				.filter(Boolean)
				.join(", ");
			const head = `### ${f.filename} (${f.mime ?? "unknown type"}, ${f.bytes} bytes${where ? `, ${where}` : ""})`;
			if (f.error) return `${head}\nText could not be extracted: ${f.error}`;
			if (!f.text) return `${head}\n(no extractable text)`;
			return `${head}\n\`\`\`\n${f.text}\n\`\`\``;
		})
		.join("\n\n");
}

function formatConsoleErrors(entries: ConsoleEntry[]): string {
	const errors = entries.filter((e) => e.level === "error");
	if (errors.length === 0) return "No console errors were logged.";
	return errors
		.map(
			(e) =>
				`${e.step !== undefined ? `[step ${e.step}] ` : ""}${e.text.replace(/\s+/g, " ").trim()}`,
		)
		.join("\n");
}

function formatScreenshots(steps: Step[]): string {
	const lines = [`${steps.length} screenshot(s) attached below, in this order:`];
	steps.forEach((s, i) => {
		lines.push(
			`${i + 1}. step ${s.index} (turn ${s.turn}): ${describeAction(s.action)} — ${s.screenshot ?? "?"}`,
		);
	});
	return lines.join("\n");
}

function formatCriterion(c: LlmCriterion): string {
	const lines = [
		`id: ${c.id}`,
		`description: ${trim(c.description)}`,
		`scale: ${c.scale}`,
		`weight: ${c.weight}`,
		`required: ${c.required ? "yes — failing it fails the whole run" : "no"}`,
	];
	if (c.levels && Object.keys(c.levels).length > 0) {
		lines.push("levels:");
		for (const [level, text] of Object.entries(c.levels).sort(
			([a], [b]) => Number(a) - Number(b),
		)) {
			lines.push(`  ${level}: ${trim(text)}`);
		}
	}
	return lines.join("\n");
}

function scaleInstruction(scale: LlmCriterion["scale"]): string {
	switch (scale) {
		case "binary":
			return "`score` is 1 when the criterion is satisfied and 0 otherwise; `pass` must agree with it.";
		case "0-5":
			return "`score` is an integer from 0 to 5 (use the levels as anchors); `pass` is true when the score is 3 or higher unless the criterion says otherwise.";
		case "0-1":
			return "`score` is a number from 0 to 1; `pass` is true when the score is at least 0.5 unless the criterion says otherwise.";
	}
}

function goalBlock(run: RunRecord, maxTurns: number): string {
	const lines = [
		"## Turn budget and the simulator's own claim",
		`The simulated user used ${run.turns_used} of ${maxTurns} turns.`,
	];
	const exhausted = run.turns_used >= maxTurns || run.simulator_outcome?.reason === "max_turns";
	if (exhausted) {
		lines.push(
			"The turn budget was exhausted: the goal had to be reached within the budget, so treat anything that happened only after the last turn as not achieved.",
		);
	}
	if (run.simulator_outcome) {
		lines.push(
			`The simulator ended the conversation with reason "${run.simulator_outcome.reason}" and summarised: ${JSON.stringify(run.simulator_outcome.summary)}.`,
		);
	} else {
		lines.push("The simulator did not declare an outcome.");
	}
	lines.push(
		"This is the simulated user's claim, not evidence. Your assessment overrides it: decide from the transcript, screenshots and downloaded files whether the success criteria were met, and contradict the claim when the evidence does not support it.",
	);
	return lines.join("\n");
}

const G_EVAL_INSTRUCTION = [
	"Scoring procedure (chain of evaluation steps):",
	"1. First list the evaluation steps implied by the criterion — what concretely must be true in this conversation for it to hold.",
	"2. Check each step against the evidence (transcript, screenshots, downloaded files, console), citing turns, steps or quotes.",
	"3. Then score. Judge what actually happened in the browser, never what the bot claims. Missing evidence counts against the criterion.",
	"Keep `reason` concise and specific, and put the citations in `evidence`.",
].join("\n");

/** Builds the system prompt and user message for one LLM criterion (decision D8). */
export function buildJudgePrompt(input: JudgePromptInput): JudgePrompt {
	const { run, resolved, criterion } = input;
	const { scenario, persona, target, evaluator } = resolved;
	const maxTurns = run.max_turns || scenario.max_turns;

	const system = [
		"You are a strict, evidence-driven judge. A simulated user drove a chatbot through its web UI; you score one criterion of the evaluation rubric from the recorded evidence and answer with structured output only.",
		"",
		"## Principles",
		trim(evaluator.principles),
		...(evaluator.judge_instructions
			? ["", "## Additional judge instructions", trim(evaluator.judge_instructions)]
			: []),
		"",
		"## How to score",
		G_EVAL_INSTRUCTION,
	].join("\n");

	const fm = persona.frontmatter;
	const personaLines = [
		`${fm.name} — ${trim(fm.description)}`,
		`language: ${fm.language}`,
		fm.traits.length ? `traits: ${fm.traits.join(", ")}` : "",
		fm.interaction_style.length ? `interaction style: ${fm.interaction_style.join(", ")}` : "",
	].filter(Boolean);

	const targetLines = [
		`${target.name} — ${target.url}${target.description ? ` — ${trim(target.description)}` : ""}`,
		...(target.hints.length ? ["hints:", ...target.hints.map((h) => `- ${trim(h)}`)] : []),
	];

	const scenarioLines = [
		`name: ${scenario.name}`,
		scenario.description ? `description: ${trim(scenario.description)}` : "",
		`goal: ${trim(scenario.goal)}`,
		`intent: ${trim(scenario.intent)}`,
		scenario.context ? `context: ${trim(scenario.context)}` : "",
		`success_criteria: ${trim(scenario.success_criteria)}`,
		`max_turns: ${maxTurns}`,
		`turns_used: ${run.turns_used}`,
		scenario.expected_artifacts.length
			? `expected_artifacts: ${scenario.expected_artifacts.map((a) => `${a.type}${a.mime ? ` (${a.mime})` : ""}${a.description ? ` — ${trim(a.description)}` : ""}`).join("; ")}`
			: "",
	].filter(Boolean);

	const sections = [
		"## Scenario",
		scenarioLines.join("\n"),
		"",
		"## Simulated user (persona)",
		personaLines.join("\n"),
		"",
		"## Target",
		targetLines.join("\n"),
		"",
		`## Criterion to score: ${criterion.id}`,
		formatCriterion(criterion),
		scaleInstruction(criterion.scale),
	];
	if (criterion.id === GOAL_REACHED_CRITERION_ID) sections.push("", goalBlock(run, maxTurns));
	sections.push(
		"",
		`## Transcript (${input.transcript.length} entries)`,
		formatTranscript(input.transcript),
		"",
		`## Downloaded files (${input.files.length})`,
		formatFiles(input.files),
		"",
		`## Console errors (${input.console.filter((e) => e.level === "error").length})`,
		formatConsoleErrors(input.console),
		"",
		"## Screenshots",
		formatScreenshots(input.screenshots),
		"",
		"## Task",
		`Score the criterion "${criterion.id}" for this run following the scoring procedure. Return the structured result (score, pass, reason, evidence).`,
	);

	return { system, user: sections.join("\n") };
}
