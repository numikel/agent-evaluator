/**
 * Rubric editing helpers: criterion type catalogue with its type-specific fields, draft
 * factories and the live weighted-score preview (same aggregation as the judge, via
 * `computeOutcome` + `withBuiltinCriteria` semantics from the shared schemas).
 */
import { GOAL_REACHED_CRITERION_ID, goalReachedCriterion } from "@schemas/rubric";
import { computeOutcome } from "@schemas/run";
import type { Record_ } from "./yaml.js";

export type CriterionType =
	| "llm"
	| "contains"
	| "regex"
	| "file"
	| "max_response_time_ms"
	| "no_console_errors";

/** A criterion as it sits in the YAML; fields are loosely typed because the user is mid-edit. */
export type CriterionDraft = Record_ & { type?: string; id?: string };

export type FieldSpec = {
	key: string;
	label: string;
	kind: "text" | "number" | "select" | "list";
	options?: readonly string[];
	hint?: string;
	placeholder?: string;
};

export const CRITERION_TYPES: readonly { type: CriterionType; label: string; summary: string }[] = [
	{
		type: "llm",
		label: "LLM-judged",
		summary: "The judge model scores a natural-language description.",
	},
	{
		type: "contains",
		label: "Contains text",
		summary: "A literal text must appear in the transcript.",
	},
	{
		type: "regex",
		label: "Matches regex",
		summary: "A regular expression must match the transcript.",
	},
	{
		type: "file",
		label: "File downloaded",
		summary: "A downloaded file with the given type or content.",
	},
	{
		type: "max_response_time_ms",
		label: "Max response time",
		summary: "Bot replies must arrive within a time budget.",
	},
	{
		type: "no_console_errors",
		label: "No console errors",
		summary: "The chat UI must log no JavaScript errors.",
	},
];

const WHERE = ["bot", "user", "files", "any"] as const;

const FIELDS: Record<CriterionType, FieldSpec[]> = {
	llm: [
		{
			key: "scale",
			label: "Scale",
			kind: "select",
			options: ["0-5", "0-1", "binary"],
			hint: "Levels (anchors per score) can be added in the YAML pane.",
		},
	],
	contains: [
		{ key: "text", label: "Text", kind: "text" },
		{ key: "in", label: "Look in", kind: "select", options: WHERE },
		{ key: "case_sensitive", label: "Case sensitive", kind: "select", options: ["false", "true"] },
	],
	regex: [
		{ key: "pattern", label: "Pattern", kind: "text", placeholder: "sept(ember)?" },
		{ key: "flags", label: "Flags", kind: "text", hint: "Any of g i m s u y", placeholder: "i" },
		{ key: "in", label: "Look in", kind: "select", options: WHERE },
	],
	file: [
		{ key: "mime", label: "MIME type", kind: "text", placeholder: "application/pdf" },
		{ key: "min_bytes", label: "Minimum size (bytes)", kind: "number" },
		{ key: "contains", label: "Extracted text contains", kind: "text" },
	],
	max_response_time_ms: [
		{ key: "value", label: "Limit (ms)", kind: "number" },
		{ key: "aggregate", label: "Aggregate", kind: "select", options: ["max", "p95", "p50"] },
	],
	no_console_errors: [
		{
			key: "ignore",
			label: "Ignore patterns",
			kind: "list",
			hint: "One regex per line; matching console errors are tolerated.",
		},
	],
};

export function criterionFields(type: string): FieldSpec[] {
	return FIELDS[type as CriterionType] ?? [];
}

export function isCriterionType(type: unknown): type is CriterionType {
	return typeof type === "string" && type in FIELDS;
}

const DEFAULTS: Record<CriterionType, Record_> = {
	llm: { scale: "0-5" },
	contains: { text: "", in: "bot", case_sensitive: false },
	regex: { pattern: "", flags: "", in: "bot" },
	file: { mime: "application/pdf" },
	max_response_time_ms: { value: 8000, aggregate: "max" },
	no_console_errors: { ignore: [] },
};

/** A fresh criterion of `type`, numbered after the `count` criteria that already exist. */
export function newCriterion(type: CriterionType, count: number): CriterionDraft {
	return {
		id: `criterion-${count + 1}`,
		type,
		description: "",
		weight: 1,
		required: false,
		...DEFAULTS[type],
	};
}

/** Changes a criterion's type, keeping the shared fields and resetting the type-specific ones. */
export function retypeCriterion(criterion: CriterionDraft, type: CriterionType): CriterionDraft {
	const { id, description, weight, required } = criterion;
	return { id, type, description, weight, required, ...DEFAULTS[type] };
}

export type PreviewRow = {
	id: string;
	weight: number;
	/** Fraction of the total weight (0..1). */
	share: number;
	required: boolean;
	pass: boolean;
	builtin: boolean;
};

export type Preview = {
	rows: PreviewRow[];
	totalWeight: number;
	score: number;
	status: "PASSED" | "FAILED";
	requiredFailed: boolean;
};

function positiveNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * What the verdict would be if every criterion in `passing` (default: all) passed. The built-in
 * `goal_reached` criterion is prepended unless the author defined one, exactly like the judge.
 */
export function previewOutcome(
	criteria: readonly CriterionDraft[],
	passing: Readonly<Record<string, boolean>>,
	passThreshold: number,
): Preview {
	const hasGoal = criteria.some((c) => c.id === GOAL_REACHED_CRITERION_ID);
	const goal = goalReachedCriterion();
	const drafts: { draft: CriterionDraft; builtin: boolean }[] = [
		...(hasGoal ? [] : [{ draft: goal as unknown as CriterionDraft, builtin: true }]),
		...criteria.map((draft) => ({ draft, builtin: false })),
	];
	const results = drafts.map(({ draft, builtin }, index) => {
		const id = typeof draft.id === "string" && draft.id !== "" ? draft.id : `#${index + 1}`;
		const pass = passing[id] ?? true;
		return {
			id,
			score: pass ? 1 : 0,
			pass,
			weight: positiveNumber(draft.weight),
			required: draft.required === true,
			reason: "",
			evidence: [],
			builtin,
		};
	});
	const totalWeight = results.reduce((acc, r) => acc + r.weight, 0);
	const goalPass = results.find((r) => r.id === GOAL_REACHED_CRITERION_ID)?.pass ?? true;
	const outcome = computeOutcome({
		criteria: results,
		goalReached: goalPass,
		passThreshold,
	});
	return {
		rows: results.map((r) => ({
			id: r.id,
			weight: r.weight,
			share: totalWeight === 0 ? 0 : r.weight / totalWeight,
			required: r.required,
			pass: r.pass,
			builtin: r.builtin,
		})),
		totalWeight,
		score: outcome.score,
		status: outcome.status,
		requiredFailed: outcome.required_failed,
	};
}
