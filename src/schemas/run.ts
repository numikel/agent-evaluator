import { z } from "zod";
import { IsoDateTimeSchema } from "./common.js";

export const RunStatusSchema = z.enum([
	"PENDING",
	"RUNNING",
	"JUDGING",
	"PASSED",
	"FAILED",
	"ERROR",
]);
export type RunStatus = z.output<typeof RunStatusSchema>;

/** One browser action taken by the simulator. `kind` mirrors the simulator tool names. */
export const ActionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("open"), url: z.string() }),
	z.object({ kind: z.literal("snapshot") }),
	z.object({ kind: z.literal("click"), ref: z.string() }),
	z.object({ kind: z.literal("type"), ref: z.string(), text: z.string(), submit: z.boolean() }),
	z.object({ kind: z.literal("press"), key: z.string() }),
	z.object({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]), amount: z.number() }),
	z.object({ kind: z.literal("wait"), ms: z.number() }),
	z.object({ kind: z.literal("send_message"), text: z.string() }),
	z.object({ kind: z.literal("read_conversation") }),
	z.object({ kind: z.literal("download"), ref: z.string() }),
	z.object({ kind: z.literal("upload"), ref: z.string(), file: z.string() }),
	z.object({ kind: z.literal("screenshot_view") }),
	z.object({ kind: z.literal("click_at"), x: z.number(), y: z.number() }),
	z.object({ kind: z.literal("type_at"), x: z.number(), y: z.number(), text: z.string() }),
	z.object({
		kind: z.literal("end_conversation"),
		reason: z.enum(["goal_reached", "gave_up", "blocked"]),
		summary: z.string(),
	}),
]);
export type Action = z.output<typeof ActionSchema>;

/** Evidence record for one step, persisted as `steps/NNN/action.json`. Paths are relative to the run dir. */
export const StepSchema = z.object({
	index: z.number().int().positive(),
	/** Conversation turn this step belongs to (0 = pre-conversation setup, e.g. login). */
	turn: z.number().int().nonnegative().default(0),
	action: ActionSchema,
	/** Short model reasoning / tool-call summary, if available. */
	thought: z.string().optional(),
	started_at: IsoDateTimeSchema.optional(),
	duration_ms: z.number().nonnegative().optional(),
	screenshot_before: z.string().optional(),
	/** Primary screenshot of this step. */
	screenshot: z.string().optional(),
	/** Interim captures while waiting for a streaming reply. */
	interim_screenshots: z.array(z.string()).default([]),
	snapshot: z.string().optional(),
	/** Tool result text as returned to the model (truncated). */
	result: z.string().optional(),
	error: z.string().optional(),
});
export type Step = z.output<typeof StepSchema>;

export const TranscriptEntrySchema = z.object({
	turn: z.number().int().positive(),
	role: z.enum(["user", "bot"]),
	text: z.string(),
	at: IsoDateTimeSchema,
	/** Bot reply latency (first stable render) in ms; undefined for user messages. */
	latency_ms: z.number().nonnegative().optional(),
	step: z.number().int().positive().optional(),
});
export type TranscriptEntry = z.output<typeof TranscriptEntrySchema>;

export const DownloadArtifactSchema = z.object({
	/** Path relative to the run dir, e.g. `downloads/invoice-09.pdf`. */
	path: z.string(),
	filename: z.string(),
	mime: z.string().optional(),
	bytes: z.number().int().nonnegative(),
	step: z.number().int().positive().optional(),
	turn: z.number().int().nonnegative().optional(),
	/** Extracted text (first N kB) filled by the judge's extractors. */
	text_excerpt: z.string().optional(),
});
export type DownloadArtifact = z.output<typeof DownloadArtifactSchema>;

export const ConsoleEntrySchema = z.object({
	level: z.enum(["log", "info", "warn", "error"]),
	text: z.string(),
	at: IsoDateTimeSchema,
	step: z.number().int().positive().optional(),
});
export type ConsoleEntry = z.output<typeof ConsoleEntrySchema>;

export const EvidenceRefSchema = z.object({
	step: z.number().int().positive().optional(),
	turn: z.number().int().nonnegative().optional(),
	screenshot: z.string().optional(),
	quote: z.string().optional(),
});
export type EvidenceRef = z.output<typeof EvidenceRefSchema>;

export const CriterionResultSchema = z.object({
	id: z.string(),
	/** Normalised 0..1 regardless of the criterion's scale. */
	score: z.number().min(0).max(1),
	pass: z.boolean(),
	weight: z.number().positive(),
	required: z.boolean(),
	reason: z.string(),
	evidence: z.array(EvidenceRefSchema).default([]),
	/** Raw value for deterministic criteria (e.g. measured latency). */
	raw: z.unknown().optional(),
});
export type CriterionResult = z.output<typeof CriterionResultSchema>;

/** `verdict.json` — the judge's output. */
export const VerdictSchema = z.object({
	runId: z.string(),
	status: z.enum(["PASSED", "FAILED"]),
	goal_reached: z.boolean(),
	score: z.number().min(0).max(1),
	pass_threshold: z.number().min(0).max(1),
	turns_used: z.number().int().nonnegative(),
	max_turns: z.number().int().positive(),
	criteria: z.array(CriterionResultSchema),
	summary: z.string(),
	/** Judge's own assessment of why the goal was / was not reached. */
	goal_assessment: z.string().optional(),
	judged_at: IsoDateTimeSchema,
	judge_model: z.string(),
	evidence_screenshots: z.array(z.string()).default([]),
});
export type Verdict = z.output<typeof VerdictSchema>;

/** `run.json` — the run record (status is updated in place as the run progresses). */
export const RunRecordSchema = z.object({
	id: z.string(),
	scenario: z.string(),
	persona: z.string(),
	target: z.string(),
	rubric: z.string(),
	/** 1-based index when `scenario.repeat > 1`. */
	repeat_index: z.number().int().positive().default(1),
	repeat_total: z.number().int().positive().default(1),
	status: RunStatusSchema,
	started_at: IsoDateTimeSchema,
	finished_at: IsoDateTimeSchema.optional(),
	turns_used: z.number().int().nonnegative().default(0),
	max_turns: z.number().int().positive(),
	models: z.object({ simulator: z.string(), judge: z.string() }),
	/** Simulator's own stop declaration, if it ended the conversation. */
	simulator_outcome: z
		.object({
			reason: z.enum(["goal_reached", "gave_up", "blocked", "max_turns", "error"]),
			summary: z.string(),
		})
		.optional(),
	error: z.string().optional(),
	/** Filled when the judge finishes; mirrors verdict.json. */
	score: z.number().min(0).max(1).optional(),
});
export type RunRecord = z.output<typeof RunRecordSchema>;

/** Lightweight listing entry derived from `run.json`. */
export const RunSummarySchema = RunRecordSchema.pick({
	id: true,
	scenario: true,
	persona: true,
	target: true,
	status: true,
	started_at: true,
	finished_at: true,
	turns_used: true,
	max_turns: true,
	score: true,
	repeat_index: true,
	repeat_total: true,
});
export type RunSummary = z.output<typeof RunSummarySchema>;

/** Streamed over SSE and persisted in `events.jsonl`. */
const EventBase = z.object({ runId: z.string(), at: IsoDateTimeSchema });
export const RunEventSchema = z.discriminatedUnion("type", [
	EventBase.extend({ type: z.literal("run_started"), run: RunRecordSchema }),
	EventBase.extend({ type: z.literal("status"), status: RunStatusSchema }),
	EventBase.extend({ type: z.literal("step"), step: StepSchema }),
	EventBase.extend({
		type: z.literal("turn"),
		turn: z.number().int().positive(),
		max_turns: z.number(),
	}),
	EventBase.extend({ type: z.literal("message"), entry: TranscriptEntrySchema }),
	EventBase.extend({ type: z.literal("download"), artifact: DownloadArtifactSchema }),
	EventBase.extend({ type: z.literal("judge_started"), criteria: z.array(z.string()) }),
	EventBase.extend({ type: z.literal("criterion"), result: CriterionResultSchema }),
	EventBase.extend({
		type: z.literal("done"),
		verdict: VerdictSchema,
		report: z.string().optional(),
	}),
	EventBase.extend({ type: z.literal("error"), message: z.string(), fatal: z.boolean() }),
	EventBase.extend({
		type: z.literal("log"),
		level: z.enum(["debug", "info", "warn"]),
		message: z.string(),
	}),
]);
export type RunEvent = z.output<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];

export type OutcomeInput = {
	criteria: Array<Pick<CriterionResult, "score" | "pass" | "weight" | "required">>;
	goalReached: boolean;
	passThreshold: number;
};

/** Pure aggregation used by the judge and the report: weighted score + PASS/FAIL per decision D7. */
export function computeOutcome(input: OutcomeInput): {
	score: number;
	status: "PASSED" | "FAILED";
	required_failed: boolean;
} {
	const totalWeight = input.criteria.reduce((acc, c) => acc + c.weight, 0);
	const score =
		totalWeight === 0
			? 0
			: input.criteria.reduce((acc, c) => acc + c.weight * c.score, 0) / totalWeight;
	const requiredFailed = input.criteria.some((c) => c.required && !c.pass);
	const pass = input.goalReached && !requiredFailed && score >= input.passThreshold;
	return { score, status: pass ? "PASSED" : "FAILED", required_failed: requiredFailed };
}
