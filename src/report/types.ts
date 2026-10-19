/**
 * Report module contract (P5). Pure renderers turn run artifacts into `report.html`,
 * `summary.json` and `junit.xml`; nothing here touches the filesystem.
 */
import { z } from "zod";
import {
	ConsoleEntrySchema,
	DownloadArtifactSchema,
	EvaluatorConfigSchema,
	PersonaFrontmatterSchema,
	RubricSchema,
	RunRecordSchema,
	ScenarioSchema,
	StepSchema,
	TargetSchema,
	TranscriptEntrySchema,
	VerdictSchema,
} from "../schemas/index.js";

/** Everything the renderers need, as read back from `runs/<id>/` plus the resolved scenario. */
export const ReportInputSchema = z.object({
	run: RunRecordSchema,
	verdict: VerdictSchema,
	steps: z.array(StepSchema),
	transcript: z.array(TranscriptEntrySchema),
	downloads: z.array(DownloadArtifactSchema),
	console: z.array(ConsoleEntrySchema),
	resolved: z.object({
		scenario: ScenarioSchema,
		/** Persona frontmatter only; the Markdown body is not shown in the report. */
		persona: PersonaFrontmatterSchema,
		target: TargetSchema,
		/** Rubric with built-in criteria applied (`withBuiltinCriteria`), used for criterion types. */
		rubric: RubricSchema,
		evaluator: EvaluatorConfigSchema,
	}),
});
export type ReportInput = z.output<typeof ReportInputSchema>;

/**
 * Loads an image referenced by a run-relative path (e.g. `steps/003/after.png`).
 * Returning `undefined` makes the renderer fall back to the relative path.
 */
export type ImageLoader = (relativePath: string) => Promise<Uint8Array | undefined>;

export type RenderHtmlOptions = {
	/** Embed screenshots as `data:` URIs (needs `imageLoader`) so the HTML is a single file. */
	inlineImages?: boolean;
	imageLoader?: ImageLoader;
};

/** `summary.json` — a compact, CI-friendly view of the verdict. */
export type ReportSummary = {
	runId: string;
	scenario: string;
	status: "PASSED" | "FAILED" | "ERROR";
	/** Weighted score 0..1 as computed by the judge. */
	score: number;
	/** `round(score * 100)`. */
	percent: number;
	pass_threshold: number;
	goal_reached: boolean;
	turns_used: number;
	max_turns: number;
	criteria: Array<{ id: string; score: number; pass: boolean; required: boolean }>;
	started_at: string;
	finished_at?: string;
};

/** File contents in the shape `RunStore.saveReport` expects. */
export type ReportFiles = {
	"report.html": string;
	"summary.json": string;
	"junit.xml": string;
};
