/**
 * In-memory fakes of the P0 contracts for server tests (reused by the CLI and E2E phases).
 * They behave like the filesystem implementations observed through the public interfaces:
 * validation before writes, `ENOENT`-style errors for missing resources, run artifacts keyed by
 * relative path.
 */
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type {
	ListModelsOptions,
	ProviderDefinition,
	ProviderRegistry,
	SecretsProvider,
} from "../config/types.js";
import type { RunEventListener, Runner, Unsubscribe } from "../runner/types.js";
import {
	type ConsoleEntry,
	type DownloadArtifact,
	type EvaluatorConfig,
	EvaluatorConfigSchema,
	MODEL_REF_PATTERN,
	type ModelInfo,
	type Persona,
	PersonaFrontmatterSchema,
	type ProviderStatus,
	parseWith,
	type ResourceKind,
	type ResourceSummary,
	type Rubric,
	RubricSchema,
	type RunEvent,
	type RunRecord,
	type RunSummary,
	type Scenario,
	ScenarioSchema,
	type Settings,
	SettingsSchema,
	type StartRunRequest,
	type Step,
	type Target,
	TargetSchema,
	type TranscriptEntry,
	ValidationError,
	type ValidationIssue,
	type Verdict,
	withBuiltinCriteria,
} from "../schemas/index.js";
import type { ResolvedScenario, RunStore, Workspace } from "../workspace/types.js";
import { WORKSPACE_DIRS, WORKSPACE_FILES } from "../workspace/types.js";
import { fromYaml, splitFrontmatter, TEMPLATE_FILENAMES } from "./documents.js";
import { guardRelativePath, templatesDir } from "./paths.js";

/** Mirrors Node's `ENOENT` so consumers can map it to HTTP 404 without knowing the implementation. */
export class NotFoundError extends Error {
	override readonly name = "NotFoundError";
	readonly code = "ENOENT";
}

type ValidateResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

const RESOURCE_SCHEMAS = {
	scenario: ScenarioSchema,
	rubric: RubricSchema,
	target: TargetSchema,
	evaluator: EvaluatorConfigSchema,
	settings: SettingsSchema,
} as const;

function relativePath(kind: ResourceKind, name?: string): string {
	switch (kind) {
		case "persona":
			return `${WORKSPACE_DIRS.personas}/${name}.md`;
		case "scenario":
			return `${WORKSPACE_DIRS.scenarios}/${name}.yaml`;
		case "rubric":
			return `${WORKSPACE_DIRS.rubrics}/${name}.yaml`;
		case "target":
			return `${WORKSPACE_DIRS.targets}/${name}.yaml`;
		case "evaluator":
			return WORKSPACE_FILES.evaluator;
		case "settings":
			return WORKSPACE_FILES.settings;
	}
}

function parseYamlSafely(
	content: string,
): { ok: true; data: unknown } | { ok: false; issues: ValidationIssue[] } {
	try {
		return { ok: true, data: fromYaml(content) ?? {} };
	} catch (error) {
		return { ok: false, issues: [{ path: "", message: (error as Error).message }] };
	}
}

export class InMemoryWorkspace implements Workspace {
	readonly root: string;
	/** Relative path → raw content. */
	readonly files = new Map<string, string>();
	readonly updatedAt = new Map<string, string>();
	/** Every successful `writeRaw`, in order. */
	readonly writes: { kind: ResourceKind; name?: string; content: string }[] = [];
	/** When set, every method rejects with this error (simulates an I/O failure). */
	failWith: Error | undefined;
	/** Overrides for `template(kind)`; missing kinds fall back to the shipped `templates/` files. */
	readonly templates = new Map<ResourceKind, string>();

	constructor(root = "/fake-workspace") {
		this.root = root;
	}

	private guard(): void {
		if (this.failWith) throw this.failWith;
	}

	async init(options?: { force?: boolean }): Promise<string[]> {
		this.guard();
		const created: string[] = [];
		for (const kind of ["evaluator", "settings"] as const) {
			const path = relativePath(kind);
			if (options?.force || !this.files.has(path)) {
				this.files.set(path, await this.template(kind));
				created.push(path);
			}
		}
		return created;
	}

	async list(kind: Exclude<ResourceKind, "evaluator" | "settings">): Promise<ResourceSummary[]> {
		this.guard();
		const prefix = `${relativePath(kind, "").replace(/\.(md|yaml)$/, "")}`;
		const out: ResourceSummary[] = [];
		for (const [path, content] of this.files) {
			if (!path.startsWith(prefix)) continue;
			const name = path.slice(prefix.length).replace(/\.(md|yaml)$/, "");
			const summary: ResourceSummary = { name, path };
			const description = this.describe(kind, content);
			if (description !== undefined) summary.description = description;
			const updated = this.updatedAt.get(path);
			if (updated !== undefined) summary.updated_at = updated;
			out.push(summary);
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	private describe(kind: ResourceKind, content: string): string | undefined {
		try {
			const data = kind === "persona" ? splitFrontmatter(content)?.frontmatter : fromYaml(content);
			const description = (data as { description?: unknown } | undefined)?.description;
			return typeof description === "string" ? description : undefined;
		} catch {
			return undefined;
		}
	}

	async loadPersona(name: string): Promise<Persona> {
		const path = relativePath("persona", name);
		const raw = await this.readRaw("persona", name);
		const split = splitFrontmatter(raw);
		if (!split)
			throw new ValidationError(path, [{ path: "", message: "missing YAML frontmatter" }]);
		const parsed = parseWith(PersonaFrontmatterSchema, split.frontmatter, path);
		if (!parsed.ok) throw parsed.error;
		return { frontmatter: parsed.data, body: split.body, path };
	}

	private async loadYaml<K extends keyof typeof RESOURCE_SCHEMAS>(
		kind: K,
		name?: string,
	): Promise<ReturnType<(typeof RESOURCE_SCHEMAS)[K]["parse"]>> {
		const path = relativePath(kind, name);
		const raw = await this.readRaw(kind, name);
		const yaml = parseYamlSafely(raw);
		if (!yaml.ok) throw new ValidationError(path, yaml.issues);
		const parsed = parseWith(RESOURCE_SCHEMAS[kind], yaml.data, path);
		if (!parsed.ok) throw parsed.error;
		return parsed.data as ReturnType<(typeof RESOURCE_SCHEMAS)[K]["parse"]>;
	}

	loadScenario(name: string): Promise<Scenario> {
		return this.loadYaml("scenario", name);
	}

	loadRubric(name: string): Promise<Rubric> {
		return this.loadYaml("rubric", name);
	}

	loadTarget(name: string): Promise<Target> {
		return this.loadYaml("target", name);
	}

	loadEvaluator(): Promise<EvaluatorConfig> {
		return this.loadYaml("evaluator");
	}

	async loadSettings(): Promise<Settings> {
		this.guard();
		if (!this.files.has(relativePath("settings"))) return SettingsSchema.parse({});
		return this.loadYaml("settings");
	}

	async readRaw(kind: ResourceKind, name?: string): Promise<string> {
		this.guard();
		const path = relativePath(kind, name);
		const content = this.files.get(path);
		if (content === undefined) throw new NotFoundError(`${kind} '${name ?? path}' not found`);
		return content;
	}

	async writeRaw(kind: ResourceKind, content: string, name?: string): Promise<void> {
		this.guard();
		const path = relativePath(kind, name);
		const result = await this.validateRaw(kind, content);
		if (!result.ok) throw new ValidationError(path, result.issues);
		this.files.set(path, content);
		this.updatedAt.set(path, new Date().toISOString());
		const write: { kind: ResourceKind; name?: string; content: string } = { kind, content };
		if (name !== undefined) write.name = name;
		this.writes.push(write);
	}

	async remove(kind: Exclude<ResourceKind, "evaluator" | "settings">, name: string): Promise<void> {
		this.guard();
		const path = relativePath(kind, name);
		if (!this.files.delete(path)) throw new NotFoundError(`${kind} '${name}' not found`);
		this.updatedAt.delete(path);
	}

	async validateRaw(kind: ResourceKind, content: string): Promise<ValidateResult> {
		this.guard();
		if (kind === "persona") {
			const split = splitFrontmatter(content);
			if (!split) return { ok: false, issues: [{ path: "", message: "missing YAML frontmatter" }] };
			const parsed = parseWith(PersonaFrontmatterSchema, split.frontmatter);
			return parsed.ok ? { ok: true } : { ok: false, issues: parsed.error.issues };
		}
		const yaml = parseYamlSafely(content);
		if (!yaml.ok) return yaml;
		const parsed = parseWith(RESOURCE_SCHEMAS[kind], yaml.data);
		return parsed.ok ? { ok: true } : { ok: false, issues: parsed.error.issues };
	}

	async resolve(scenarioName: string, overrides?: { target?: string }): Promise<ResolvedScenario> {
		const scenario = await this.loadScenario(scenarioName);
		const evaluator = await this.loadEvaluator();
		const rubricName = scenario.rubric ?? evaluator.default_rubric;
		if (!rubricName) {
			throw new Error(
				`scenario '${scenarioName}' names no rubric and evaluator.yaml has no default_rubric`,
			);
		}
		const [persona, target, rubric, settings] = await Promise.all([
			this.loadPersona(scenario.persona),
			this.loadTarget(overrides?.target ?? scenario.target),
			this.loadRubric(rubricName),
			this.loadSettings(),
		]);
		return { scenario, persona, target, rubric: withBuiltinCriteria(rubric), evaluator, settings };
	}

	async template(kind: ResourceKind): Promise<string> {
		this.guard();
		const override = this.templates.get(kind);
		if (override !== undefined) return override;
		const file = TEMPLATE_FILENAMES[kind];
		if (!file) throw new NotFoundError(`unknown template kind '${kind}'`);
		return readFile(join(templatesDir(), file), "utf8");
	}
}

type RunDir = {
	record: RunRecord;
	files: Map<string, Uint8Array>;
	steps: Step[];
	transcript: TranscriptEntry[];
	console: ConsoleEntry[];
	downloads: DownloadArtifact[];
	events: RunEvent[];
	verdict?: Verdict;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toSummary(record: RunRecord): RunSummary {
	const summary: RunSummary = {
		id: record.id,
		scenario: record.scenario,
		persona: record.persona,
		target: record.target,
		status: record.status,
		started_at: record.started_at,
		turns_used: record.turns_used,
		max_turns: record.max_turns,
		repeat_index: record.repeat_index,
		repeat_total: record.repeat_total,
	};
	if (record.finished_at !== undefined) summary.finished_at = record.finished_at;
	if (record.score !== undefined) summary.score = record.score;
	return summary;
}

export class InMemoryRunStore implements RunStore {
	readonly root: string;
	readonly runs = new Map<string, RunDir>();

	constructor(root = "/fake-workspace/runs") {
		this.root = root;
	}

	private run(runId: string): RunDir {
		const run = this.runs.get(runId);
		if (!run) throw new NotFoundError(`run '${runId}' not found`);
		return run;
	}

	private put(runId: string, relativePath: string, content: string | Uint8Array): void {
		this.run(runId).files.set(
			relativePath,
			typeof content === "string" ? encoder.encode(content) : content,
		);
	}

	private appendLine(runId: string, relativePath: string, value: unknown): void {
		const run = this.run(runId);
		const previous = run.files.get(relativePath);
		const line = `${JSON.stringify(value)}\n`;
		run.files.set(
			relativePath,
			encoder.encode(`${previous ? decoder.decode(previous) : ""}${line}`),
		);
	}

	async create(record: RunRecord): Promise<string> {
		this.runs.set(record.id, {
			record: { ...record },
			files: new Map(),
			steps: [],
			transcript: [],
			console: [],
			downloads: [],
			events: [],
		});
		this.put(record.id, "run.json", JSON.stringify(record, null, 2));
		return this.dir(record.id);
	}

	dir(runId: string): string {
		return posix.join(this.root, runId);
	}

	async updateRecord(runId: string, patch: Partial<RunRecord>): Promise<RunRecord> {
		const run = this.run(runId);
		run.record = { ...run.record, ...patch };
		this.put(runId, "run.json", JSON.stringify(run.record, null, 2));
		return run.record;
	}

	async readRecord(runId: string): Promise<RunRecord> {
		return { ...this.run(runId).record };
	}

	async list(): Promise<RunSummary[]> {
		return [...this.runs.values()]
			.map((r) => toSummary(r.record))
			.sort((a, b) => b.started_at.localeCompare(a.started_at));
	}

	async saveScreenshot(
		runId: string,
		stepIndex: number,
		name: string,
		png: Uint8Array,
	): Promise<string> {
		const path = `steps/${String(stepIndex).padStart(3, "0")}/${name}.png`;
		this.put(runId, path, png);
		return path;
	}

	async saveSnapshot(runId: string, stepIndex: number, tree: string): Promise<string> {
		const path = `steps/${String(stepIndex).padStart(3, "0")}/snapshot.yaml`;
		this.put(runId, path, tree);
		return path;
	}

	async saveStep(runId: string, step: Step): Promise<void> {
		this.run(runId).steps.push(step);
		this.put(
			runId,
			`steps/${String(step.index).padStart(3, "0")}/action.json`,
			JSON.stringify(step, null, 2),
		);
	}

	async appendTranscript(runId: string, entry: TranscriptEntry): Promise<void> {
		this.run(runId).transcript.push(entry);
		this.appendLine(runId, "transcript.jsonl", entry);
	}

	async appendConsole(runId: string, entries: ConsoleEntry[]): Promise<void> {
		for (const entry of entries) {
			this.run(runId).console.push(entry);
			this.appendLine(runId, "console.jsonl", entry);
		}
	}

	async appendEvent(runId: string, event: RunEvent): Promise<void> {
		this.run(runId).events.push(event);
		this.appendLine(runId, "events.jsonl", event);
	}

	async saveDownload(
		runId: string,
		sourcePath: string,
		meta: Omit<DownloadArtifact, "path">,
	): Promise<DownloadArtifact> {
		const artifact: DownloadArtifact = { ...meta, path: `downloads/${meta.filename}` };
		this.run(runId).downloads.push(artifact);
		this.put(runId, artifact.path, encoder.encode(`<moved from ${sourcePath}>`));
		this.put(runId, "downloads.json", JSON.stringify(this.run(runId).downloads, null, 2));
		return artifact;
	}

	async saveVerdict(runId: string, verdict: Verdict): Promise<void> {
		this.run(runId).verdict = verdict;
		this.put(runId, "verdict.json", JSON.stringify(verdict, null, 2));
	}

	async saveReport(
		runId: string,
		files: { "report.html": string; "summary.json": string; "junit.xml": string },
	): Promise<void> {
		for (const [name, content] of Object.entries(files)) this.put(runId, name, content);
	}

	async readSteps(runId: string): Promise<Step[]> {
		return [...this.run(runId).steps];
	}

	async readTranscript(runId: string): Promise<TranscriptEntry[]> {
		return [...this.run(runId).transcript];
	}

	async readConsole(runId: string): Promise<ConsoleEntry[]> {
		return [...this.run(runId).console];
	}

	async readDownloads(runId: string): Promise<DownloadArtifact[]> {
		return [...this.run(runId).downloads];
	}

	async readVerdict(runId: string): Promise<Verdict | undefined> {
		return this.run(runId).verdict;
	}

	async readFile(runId: string, relativePath: string): Promise<Uint8Array> {
		const content = this.run(runId).files.get(guardRelativePath(relativePath));
		if (!content) throw new NotFoundError(`${relativePath} not found in run '${runId}'`);
		return content;
	}

	artifactPath(runId: string, relativePath: string): string {
		return posix.join(this.dir(runId), guardRelativePath(relativePath));
	}
}

export type FakeRunnerOptions = {
	/** When given, `start` creates a PENDING record per run so the API can list/describe it. */
	runStore?: RunStore;
	now?: () => string;
};

export class FakeRunner implements Runner {
	readonly started: StartRunRequest[] = [];
	readonly cancelled: string[] = [];
	/** When set, `start` rejects with it (e.g. a `RunPreconditionError`). */
	precondition: Error | undefined;
	private readonly listeners = new Map<string, Set<RunEventListener>>();
	private nextId = 1;
	private readonly options: FakeRunnerOptions;

	constructor(options: FakeRunnerOptions = {}) {
		this.options = options;
	}

	async start(request: StartRunRequest): Promise<{ runIds: string[] }> {
		if (this.precondition) throw this.precondition;
		this.started.push(request);
		const total = request.repeat ?? 1;
		const runIds: string[] = [];
		for (let i = 1; i <= total; i++) {
			const id = `run-${this.nextId++}`;
			runIds.push(id);
			await this.options.runStore?.create({
				id,
				scenario: request.scenario,
				persona: "persona",
				target: request.target ?? "target",
				rubric: "rubric",
				repeat_index: i,
				repeat_total: total,
				status: "PENDING",
				started_at: this.options.now?.() ?? new Date().toISOString(),
				turns_used: 0,
				max_turns: 10,
				models: { simulator: "fake:model", judge: "fake:model" },
			});
		}
		return { runIds };
	}

	async cancel(runId: string): Promise<void> {
		this.cancelled.push(runId);
	}

	subscribe(runId: string, listener: RunEventListener): Unsubscribe {
		let set = this.listeners.get(runId);
		if (!set) {
			set = new Set();
			this.listeners.set(runId, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
			if (set.size === 0) this.listeners.delete(runId);
		};
	}

	async active(): Promise<RunSummary[]> {
		const all = (await this.options.runStore?.list()) ?? [];
		return all.filter(
			(r) => r.status === "PENDING" || r.status === "RUNNING" || r.status === "JUDGING",
		);
	}

	/** Dispatches a live event to every subscriber of `event.runId`. */
	emit(event: RunEvent): void {
		for (const listener of this.listeners.get(event.runId) ?? []) listener(event);
	}

	listenerCount(runId: string): number {
		return this.listeners.get(runId)?.size ?? 0;
	}
}

export const FAKE_PROVIDERS: ProviderDefinition[] = [
	{
		id: "openai",
		label: "OpenAI",
		env: "OPENAI_API_KEY",
		package: "@langchain/openai",
		examples: ["gpt-example"],
		modelsEndpoint: "https://api.openai.com/v1/models",
		effortKnob: "openai",
	},
	{
		id: "anthropic",
		label: "Anthropic",
		env: "ANTHROPIC_API_KEY",
		package: "@langchain/anthropic",
		examples: ["claude-example"],
		modelsEndpoint: "https://api.anthropic.com/v1/models",
		effortKnob: "anthropic",
	},
	{
		id: "ollama",
		label: "Ollama",
		env: "OLLAMA_BASE_URL",
		package: "@langchain/ollama",
		examples: ["llama-example"],
		effortKnob: "ollama",
	},
];

export class FakeProviderRegistry implements ProviderRegistry {
	readonly definitions: ProviderDefinition[];
	/** Models returned per provider id; providers without an entry fall back to `examples`. */
	readonly models = new Map<string, ModelInfo[]>();
	/** Provider id → error message that makes `listModels` report a fallback. */
	readonly failures = new Map<string, string>();
	readonly listCalls: { providerId: string; refresh: boolean }[] = [];

	constructor(definitions: ProviderDefinition[] = FAKE_PROVIDERS) {
		this.definitions = definitions;
	}

	all(): ProviderDefinition[] {
		return [...this.definitions];
	}

	status(secrets: SecretsProvider): ProviderStatus[] {
		return this.definitions.map((d) => ({
			id: d.id,
			label: d.label,
			env: d.env,
			configured: secrets.has(d.env),
		}));
	}

	configured(secrets: SecretsProvider): ProviderDefinition[] {
		return this.definitions.filter((d) => secrets.has(d.env));
	}

	async listModels(
		providerId: string,
		_secrets: SecretsProvider,
		options?: ListModelsOptions,
	): Promise<{ models: ModelInfo[]; source: "api" | "fallback"; error?: string }> {
		this.listCalls.push({ providerId, refresh: options?.refresh === true });
		const definition = this.definitions.find((d) => d.id === providerId);
		if (!definition) throw new NotFoundError(`unknown provider '${providerId}'`);
		const examples = definition.examples.map((id) => ({
			provider: providerId,
			id,
			label: id,
			ref: `${providerId}:${id}`,
		}));
		const failure = this.failures.get(providerId);
		if (failure !== undefined) return { models: examples, source: "fallback", error: failure };
		return { models: this.models.get(providerId) ?? examples, source: "api" };
	}

	parseRef(ref: string): { provider: string; model: string } {
		if (!MODEL_REF_PATTERN.test(ref)) {
			throw new Error(`'${ref}' must be an explicit 'provider:model' reference`);
		}
		const index = ref.indexOf(":");
		return { provider: ref.slice(0, index), model: ref.slice(index + 1) };
	}
}

export class FakeSecrets implements SecretsProvider {
	private readonly values = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [k, v] of Object.entries(initial)) this.values.set(k, v);
	}

	set(name: string, value: string): this {
		this.values.set(name, value);
		return this;
	}

	delete(name: string): void {
		this.values.delete(name);
	}

	get(name: string): string | undefined {
		return this.values.get(name);
	}

	has(name: string): boolean {
		return this.values.has(name);
	}
}

export type FakeDeps = {
	workspace: InMemoryWorkspace;
	runStore: InMemoryRunStore;
	runner: FakeRunner;
	providers: FakeProviderRegistry;
	secrets: FakeSecrets;
};

/** One wired set of fakes: the runner creates records in the run store. */
export function createFakeDeps(): FakeDeps {
	const workspace = new InMemoryWorkspace();
	const runStore = new InMemoryRunStore(`${workspace.root}/runs`);
	return {
		workspace,
		runStore,
		runner: new FakeRunner({ runStore }),
		providers: new FakeProviderRegistry(),
		secrets: new FakeSecrets(),
	};
}
