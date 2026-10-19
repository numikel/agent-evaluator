/**
 * FROZEN CONTRACT (P0). Filesystem workspace + run artifact store.
 * Implemented in P1; consumed by the server (P8), judge (P7), runner (P10) and CLI (P11).
 */
import type {
	ConsoleEntry,
	DownloadArtifact,
	EvaluatorConfig,
	Persona,
	ResourceKind,
	ResourceSummary,
	Rubric,
	RunEvent,
	RunRecord,
	RunSummary,
	Scenario,
	Settings,
	Step,
	Target,
	TranscriptEntry,
	Verdict,
} from "../schemas/index.js";

export const WORKSPACE_DIRS = {
	personas: "personas",
	scenarios: "scenarios",
	rubrics: "rubrics",
	targets: "targets",
} as const;

export const WORKSPACE_FILES = {
	evaluator: "evaluator.yaml",
	settings: "agent-evaluator.yaml",
} as const;

/** Resolved scenario with all cross-referenced documents loaded. */
export type ResolvedScenario = {
	scenario: Scenario;
	persona: Persona;
	target: Target;
	/** Rubric with built-in criteria already applied (see `withBuiltinCriteria`). */
	rubric: Rubric;
	evaluator: EvaluatorConfig;
	settings: Settings;
};

export interface Workspace {
	readonly root: string;
	/** Creates the directory layout and copies templates for missing files. Idempotent. */
	init(options?: { force?: boolean }): Promise<string[]>;

	list(kind: Exclude<ResourceKind, "evaluator" | "settings">): Promise<ResourceSummary[]>;

	loadPersona(name: string): Promise<Persona>;
	loadScenario(name: string): Promise<Scenario>;
	loadRubric(name: string): Promise<Rubric>;
	loadTarget(name: string): Promise<Target>;
	loadEvaluator(): Promise<EvaluatorConfig>;
	loadSettings(): Promise<Settings>;

	/** Raw file content for editors (Markdown for personas, YAML otherwise). */
	readRaw(kind: ResourceKind, name?: string): Promise<string>;
	/** Validates then writes raw content; throws `ValidationError` on invalid input. */
	writeRaw(kind: ResourceKind, content: string, name?: string): Promise<void>;
	remove(kind: Exclude<ResourceKind, "evaluator" | "settings">, name: string): Promise<void>;
	/** Validates raw content without writing. */
	validateRaw(
		kind: ResourceKind,
		content: string,
	): Promise<{ ok: true } | { ok: false; issues: { path: string; message: string }[] }>;

	/** Loads a scenario and everything it references. */
	resolve(scenarioName: string, overrides?: { target?: string }): Promise<ResolvedScenario>;

	/** Template text shipped with the package for the given kind. */
	template(kind: ResourceKind): Promise<string>;
}

/** Writes and reads `runs/<id>/…`. All relative paths are relative to the run directory. */
export interface RunStore {
	readonly root: string;
	create(record: RunRecord): Promise<string>;
	/** Absolute directory of a run. */
	dir(runId: string): string;
	updateRecord(runId: string, patch: Partial<RunRecord>): Promise<RunRecord>;
	readRecord(runId: string): Promise<RunRecord>;
	list(): Promise<RunSummary[]>;

	/** Returns the relative path of the saved PNG, e.g. `steps/003/after.png`. */
	saveScreenshot(runId: string, stepIndex: number, name: string, png: Uint8Array): Promise<string>;
	saveSnapshot(runId: string, stepIndex: number, tree: string): Promise<string>;
	saveStep(runId: string, step: Step): Promise<void>;
	appendTranscript(runId: string, entry: TranscriptEntry): Promise<void>;
	appendConsole(runId: string, entries: ConsoleEntry[]): Promise<void>;
	appendEvent(runId: string, event: RunEvent): Promise<void>;
	/** Moves a downloaded file into `downloads/` and returns its artifact record. */
	saveDownload(
		runId: string,
		sourcePath: string,
		meta: Omit<DownloadArtifact, "path">,
	): Promise<DownloadArtifact>;
	saveVerdict(runId: string, verdict: Verdict): Promise<void>;
	saveReport(
		runId: string,
		files: { "report.html": string; "summary.json": string; "junit.xml": string },
	): Promise<void>;

	readSteps(runId: string): Promise<Step[]>;
	readTranscript(runId: string): Promise<TranscriptEntry[]>;
	readConsole(runId: string): Promise<ConsoleEntry[]>;
	readDownloads(runId: string): Promise<DownloadArtifact[]>;
	readVerdict(runId: string): Promise<Verdict | undefined>;
	readFile(runId: string, relativePath: string): Promise<Uint8Array>;
	/** Resolves and guards a relative artifact path (no traversal outside the run dir). */
	artifactPath(runId: string, relativePath: string): string;
}
