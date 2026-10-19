import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import {
	basename,
	extname,
	isAbsolute,
	join,
	posix,
	relative,
	resolve as resolvePath,
	sep,
} from "node:path";
import {
	type ConsoleEntry,
	ConsoleEntrySchema,
	type DownloadArtifact,
	DownloadArtifactSchema,
	parseOrThrow,
	type RunEvent,
	type RunRecord,
	RunRecordSchema,
	type RunSummary,
	RunSummarySchema,
	type Step,
	StepSchema,
	type TranscriptEntry,
	TranscriptEntrySchema,
	type Verdict,
	VerdictSchema,
} from "../schemas/index.js";
import { isNotFound, pathExists, readTextIfExists, writeFileAtomic } from "./fs-utils.js";
import type { RunStore } from "./types.js";

const RUN_FILES = {
	record: "run.json",
	events: "events.jsonl",
	transcript: "transcript.jsonl",
	console: "console.jsonl",
	downloads: "downloads.json",
	verdict: "verdict.json",
	steps: "steps",
	downloadsDir: "downloads",
} as const;

const STEP_FILES = { snapshot: "snapshot.txt", action: "action.json" } as const;

/** Run ids become directory names: a single path segment, no separators, no `.`/`..`. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertRunId(runId: string): string {
	if (!RUN_ID_PATTERN.test(runId) || runId === "." || runId === "..") {
		throw new Error(`invalid run id '${runId}': must be a single path segment`);
	}
	return runId;
}

const stepDir = (index: number): string => String(index).padStart(3, "0");

const toJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function parseJsonl(text: string | undefined): unknown[] {
	if (!text) return [];
	return text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as unknown);
}

/**
 * Filesystem {@link RunStore}: `root` is the runs directory (e.g. `<workspace>/runs`) and every
 * run lives in `root/<runId>/…` following the evidence layout in `docs/architecture.md`.
 */
export class FsRunStore implements RunStore {
	readonly root: string;

	constructor(root: string) {
		this.root = resolvePath(root);
	}

	dir(runId: string): string {
		return join(this.root, assertRunId(runId));
	}

	artifactPath(runId: string, relativePath: string): string {
		const dir = this.dir(runId);
		if (isAbsolute(relativePath) || posix.isAbsolute(relativePath)) {
			throw new Error(`artifact path '${relativePath}' must be relative, not absolute`);
		}
		const resolved = resolvePath(dir, relativePath);
		const rel = relative(dir, resolved);
		if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
			throw new Error(`artifact path '${relativePath}' resolves outside the run directory`);
		}
		return resolved;
	}

	private async writeJson(runId: string, relativePath: string, value: unknown): Promise<void> {
		await writeFileAtomic(this.artifactPath(runId, relativePath), toJson(value));
	}

	private async appendJsonl(runId: string, relativePath: string, values: unknown[]): Promise<void> {
		if (values.length === 0) return;
		const path = this.artifactPath(runId, relativePath);
		await mkdir(this.dir(runId), { recursive: true });
		await appendFile(path, values.map((v) => `${JSON.stringify(v)}\n`).join(""));
	}

	private async readJsonl(runId: string, relativePath: string): Promise<unknown[]> {
		return parseJsonl(await readTextIfExists(this.artifactPath(runId, relativePath)));
	}

	async create(record: RunRecord): Promise<string> {
		const dir = this.dir(record.id);
		const validated = parseOrThrow(RunRecordSchema, record, `${record.id}/${RUN_FILES.record}`);
		await mkdir(dir, { recursive: true });
		await this.writeJson(record.id, RUN_FILES.record, validated);
		return dir;
	}

	async readRecord(runId: string): Promise<RunRecord> {
		const source = `${runId}/${RUN_FILES.record}`;
		const text = await readTextIfExists(this.artifactPath(runId, RUN_FILES.record));
		if (text === undefined) throw new Error(`run '${runId}' not found (expected ${source})`);
		return parseOrThrow(RunRecordSchema, JSON.parse(text), source);
	}

	async updateRecord(runId: string, patch: Partial<RunRecord>): Promise<RunRecord> {
		const current = await this.readRecord(runId);
		const merged = parseOrThrow(
			RunRecordSchema,
			{ ...current, ...patch, id: current.id },
			`${runId}/${RUN_FILES.record}`,
		);
		await this.writeJson(runId, RUN_FILES.record, merged);
		return merged;
	}

	async list(): Promise<RunSummary[]> {
		let entries: string[];
		try {
			entries = await readdir(this.root);
		} catch (error) {
			if (isNotFound(error)) return [];
			throw error;
		}
		const summaries: RunSummary[] = [];
		for (const name of entries) {
			if (!RUN_ID_PATTERN.test(name)) continue;
			const info = await stat(join(this.root, name));
			if (!info.isDirectory()) continue;
			const text = await readTextIfExists(join(this.root, name, RUN_FILES.record));
			if (text === undefined) continue;
			const parsed = RunSummarySchema.safeParse(JSON.parse(text));
			if (parsed.success) summaries.push(parsed.data);
		}
		return summaries.sort(
			(a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id),
		);
	}

	async saveScreenshot(
		runId: string,
		stepIndex: number,
		name: string,
		png: Uint8Array,
	): Promise<string> {
		const file = extname(name) === ".png" ? name : `${name}.png`;
		const relativePath = posix.join(RUN_FILES.steps, stepDir(stepIndex), file);
		await writeFileAtomic(this.artifactPath(runId, relativePath), png);
		return relativePath;
	}

	async saveSnapshot(runId: string, stepIndex: number, tree: string): Promise<string> {
		const relativePath = posix.join(RUN_FILES.steps, stepDir(stepIndex), STEP_FILES.snapshot);
		await writeFileAtomic(this.artifactPath(runId, relativePath), tree);
		return relativePath;
	}

	async saveStep(runId: string, step: Step): Promise<void> {
		const relativePath = posix.join(RUN_FILES.steps, stepDir(step.index), STEP_FILES.action);
		await this.writeJson(
			runId,
			relativePath,
			parseOrThrow(StepSchema, step, `${runId}/${relativePath}`),
		);
	}

	appendTranscript(runId: string, entry: TranscriptEntry): Promise<void> {
		return this.appendJsonl(runId, RUN_FILES.transcript, [entry]);
	}

	appendConsole(runId: string, entries: ConsoleEntry[]): Promise<void> {
		return this.appendJsonl(runId, RUN_FILES.console, entries);
	}

	appendEvent(runId: string, event: RunEvent): Promise<void> {
		return this.appendJsonl(runId, RUN_FILES.events, [event]);
	}

	async saveDownload(
		runId: string,
		sourcePath: string,
		meta: Omit<DownloadArtifact, "path">,
	): Promise<DownloadArtifact> {
		const downloadsDir = this.artifactPath(runId, RUN_FILES.downloadsDir);
		await mkdir(downloadsDir, { recursive: true });
		const filename = await this.uniqueDownloadName(runId, basename(meta.filename));
		const relativePath = posix.join(RUN_FILES.downloadsDir, filename);
		const destination = this.artifactPath(runId, relativePath);
		await moveFile(sourcePath, destination);
		const { size } = await stat(destination);

		const artifact = parseOrThrow(
			DownloadArtifactSchema,
			{ ...meta, path: relativePath, bytes: size },
			`${runId}/${relativePath}`,
		);
		const index = await this.readDownloads(runId);
		await this.writeJson(runId, RUN_FILES.downloads, [...index, artifact]);
		return artifact;
	}

	private async uniqueDownloadName(runId: string, filename: string): Promise<string> {
		const extension = extname(filename);
		const stem = filename.slice(0, filename.length - extension.length) || "download";
		let candidate = `${stem}${extension}`;
		for (
			let n = 2;
			await pathExists(this.artifactPath(runId, posix.join(RUN_FILES.downloadsDir, candidate)));
			n += 1
		) {
			candidate = `${stem}-${n}${extension}`;
		}
		return candidate;
	}

	async saveVerdict(runId: string, verdict: Verdict): Promise<void> {
		await this.writeJson(
			runId,
			RUN_FILES.verdict,
			parseOrThrow(VerdictSchema, verdict, `${runId}/${RUN_FILES.verdict}`),
		);
	}

	async saveReport(
		runId: string,
		files: { "report.html": string; "summary.json": string; "junit.xml": string },
	): Promise<void> {
		for (const [name, content] of Object.entries(files)) {
			await writeFileAtomic(this.artifactPath(runId, name), content);
		}
	}

	async readSteps(runId: string): Promise<Step[]> {
		const stepsDir = this.artifactPath(runId, RUN_FILES.steps);
		let entries: string[];
		try {
			entries = await readdir(stepsDir);
		} catch (error) {
			if (isNotFound(error)) return [];
			throw error;
		}
		const steps: Step[] = [];
		for (const name of entries.filter((e) => /^\d+$/.test(e)).sort()) {
			const relativePath = posix.join(RUN_FILES.steps, name, STEP_FILES.action);
			const text = await readTextIfExists(this.artifactPath(runId, relativePath));
			if (text === undefined) continue;
			steps.push(parseOrThrow(StepSchema, JSON.parse(text), `${runId}/${relativePath}`));
		}
		return steps.sort((a, b) => a.index - b.index);
	}

	async readTranscript(runId: string): Promise<TranscriptEntry[]> {
		const source = `${runId}/${RUN_FILES.transcript}`;
		return (await this.readJsonl(runId, RUN_FILES.transcript)).map((line) =>
			parseOrThrow(TranscriptEntrySchema, line, source),
		);
	}

	async readConsole(runId: string): Promise<ConsoleEntry[]> {
		const source = `${runId}/${RUN_FILES.console}`;
		return (await this.readJsonl(runId, RUN_FILES.console)).map((line) =>
			parseOrThrow(ConsoleEntrySchema, line, source),
		);
	}

	async readDownloads(runId: string): Promise<DownloadArtifact[]> {
		const text = await readTextIfExists(this.artifactPath(runId, RUN_FILES.downloads));
		if (text === undefined) return [];
		const source = `${runId}/${RUN_FILES.downloads}`;
		const data: unknown = JSON.parse(text);
		if (!Array.isArray(data)) throw new Error(`${source} must contain a JSON array`);
		return data.map((item) => parseOrThrow(DownloadArtifactSchema, item, source));
	}

	async readVerdict(runId: string): Promise<Verdict | undefined> {
		const text = await readTextIfExists(this.artifactPath(runId, RUN_FILES.verdict));
		if (text === undefined) return undefined;
		return parseOrThrow(VerdictSchema, JSON.parse(text), `${runId}/${RUN_FILES.verdict}`);
	}

	async readFile(runId: string, relativePath: string): Promise<Uint8Array> {
		return new Uint8Array(await readFile(this.artifactPath(runId, relativePath)));
	}
}

/** `rename` when possible, copy + delete when the source lives on another device. */
async function moveFile(source: string, destination: string): Promise<void> {
	try {
		await rename(source, destination);
	} catch (error) {
		if ((error as { code?: string }).code !== "EXDEV") throw error;
		await copyFile(source, destination);
		await rm(source, { force: true });
	}
}
