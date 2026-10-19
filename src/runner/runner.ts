/**
 * `createRunner` (P10): resolves scenarios, expands repeats, queues runs behind a concurrency
 * semaphore, streams each run's LangGraph graph and fans events out to subscribers after
 * persisting them to `events.jsonl`.
 */
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import type { BrowserSessionFactory } from "../browser/types.js";
import type { ModelFactory } from "../config/types.js";
import {
	type RunEvent,
	type RunRecord,
	type RunSummary,
	RunSummarySchema,
	type Settings,
	type StartRunRequest,
} from "../schemas/index.js";
import type { ResolvedScenario, RunStore, Workspace } from "../workspace/types.js";
import {
	buildRunGraph,
	type RunContext,
	type RunEventInput,
	type RunGraphStateType,
	type RunModels,
	type RunnerLogger,
	releaseBrowser,
} from "./graph.js";
import {
	type RunEventListener,
	type Runner,
	RunPreconditionError,
	type Unsubscribe,
} from "./types.js";

export type RunnerDeps = {
	workspace: Workspace;
	runStore: RunStore;
	/** `close()` (as on `PlaywrightSessionFactory`) is called by `runner.close()` when present. */
	browserFactory: BrowserSessionFactory & { close?(): Promise<void> };
	modelFactory: ModelFactory;
	/** pino-compatible; silent when omitted. */
	logger?: RunnerLogger;
	/** Clock for run ids, timestamps and `judged_at`; defaults to `() => new Date()`. */
	now?: () => Date;
};

/**
 * The frozen `Runner` contract plus two additive helpers:
 * - `wait(runId)` resolves with the final `RunRecord` once the run reaches a terminal status;
 * - `close()` cancels in-flight runs, waits for them and closes the browser factory.
 */
export interface RunnerHandle extends Runner {
	wait(runId: string): Promise<RunRecord>;
	close(): Promise<void>;
}

const SILENT_LOGGER: RunnerLogger = { info() {}, warn() {}, error() {} };

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `YYYYMMDD-HHMMSS-<scenario>-<4 hex>` in local time, so `runs/` sorts chronologically. */
export function formatRunId(at: Date, scenario: string, suffix: string): string {
	const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
	const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
	return `${date}-${time}-${scenario}-${suffix}`;
}

/** Minimal counting semaphore; `limit` can be lowered or raised between acquisitions. */
class Semaphore {
	private running = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(public limit: number) {}

	async acquire(): Promise<() => void> {
		if (this.running >= this.limit) {
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		}
		this.running += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.running -= 1;
			if (this.running < this.limit) this.waiters.shift()?.();
		};
	}
}

type Job = {
	record: RunRecord;
	resolved: ResolvedScenario;
	models: RunModels;
	headless: boolean;
	controller: AbortController;
	done: Promise<RunRecord>;
	finish: (record: RunRecord) => void;
	finished: boolean;
};

class FsRunner implements RunnerHandle {
	private readonly jobs = new Map<string, Job>();
	private readonly listeners = new Map<string, Set<RunEventListener>>();
	private readonly semaphore = new Semaphore(1);
	private readonly logger: RunnerLogger;
	private readonly now: () => Date;
	private closed = false;

	constructor(private readonly deps: RunnerDeps) {
		this.logger = deps.logger ?? SILENT_LOGGER;
		this.now = deps.now ?? (() => new Date());
	}

	async start(request: StartRunRequest): Promise<{ runIds: string[] }> {
		if (this.closed) throw new RunPreconditionError("the runner has been closed");
		const resolved = await this.resolve(request);
		const { settings, scenario } = resolved;
		const total = scenario.repeat * (request.repeat ?? 1);
		const headless = request.headless ?? (settings.browser.headless && resolved.target.headless);

		// Models are built per run (stateless for real providers, fresh scripts in tests) and
		// before any record is written so an unconfigured provider leaves nothing behind.
		const models: RunModels[] = [];
		for (let i = 0; i < total; i++) models.push(await this.buildModels(settings));

		const jobs: Job[] = [];
		for (let i = 1; i <= total; i++) {
			const record = await this.createRecord(resolved, i, total);
			let finish: Job["finish"] = () => undefined;
			const done = new Promise<RunRecord>((resolve) => {
				finish = resolve;
			});
			const job: Job = {
				record,
				resolved,
				models: models[i - 1] as RunModels,
				headless,
				controller: new AbortController(),
				done,
				finish,
				finished: false,
			};
			this.jobs.set(record.id, job);
			jobs.push(job);
		}
		this.semaphore.limit = settings.concurrency;
		for (const job of jobs) void this.schedule(job);
		return { runIds: jobs.map((j) => j.record.id) };
	}

	async cancel(runId: string): Promise<void> {
		const job = this.jobs.get(runId);
		if (!job || job.finished) return;
		this.logger.info(`[${runId}] cancellation requested`);
		job.controller.abort();
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
		const summaries: RunSummary[] = [];
		for (const job of this.jobs.values()) {
			if (job.finished) continue;
			try {
				summaries.push(RunSummarySchema.parse(await this.deps.runStore.readRecord(job.record.id)));
			} catch {
				// The record vanished (run dir removed); it is no longer active.
			}
		}
		return summaries;
	}

	async wait(runId: string): Promise<RunRecord> {
		const job = this.jobs.get(runId);
		return job ? job.done : this.deps.runStore.readRecord(runId);
	}

	async close(): Promise<void> {
		this.closed = true;
		const pending = Array.from(this.jobs.values()).filter((j) => !j.finished);
		for (const job of pending) job.controller.abort();
		await Promise.all(pending.map((j) => j.done));
		await this.deps.browserFactory.close?.();
	}

	// --- internals ----------------------------------------------------------------------------

	private async resolve(request: StartRunRequest): Promise<ResolvedScenario> {
		try {
			return await this.deps.workspace.resolve(
				request.scenario,
				request.target ? { target: request.target } : undefined,
			);
		} catch (error) {
			throw new RunPreconditionError(errorMessage(error), { cause: error });
		}
	}

	private async buildModels(settings: Settings): Promise<RunModels> {
		try {
			const models: RunModels = {
				simulator: await this.deps.modelFactory.forRole("simulator", settings),
				judge: await this.deps.modelFactory.forRole("judge", settings),
			};
			if (settings.models.evidence_selector !== undefined) {
				models.selector = await this.deps.modelFactory.forRole("evidence_selector", settings);
			}
			return models;
		} catch (error) {
			throw new RunPreconditionError(errorMessage(error), { cause: error });
		}
	}

	private async createRecord(
		resolved: ResolvedScenario,
		index: number,
		total: number,
	): Promise<RunRecord> {
		const { scenario, persona, target, rubric, settings } = resolved;
		const at = this.now();
		let id = formatRunId(at, scenario.name, randomBytes(2).toString("hex"));
		while (await exists(this.deps.runStore.dir(id))) {
			id = formatRunId(at, scenario.name, randomBytes(2).toString("hex"));
		}
		const record: RunRecord = {
			id,
			scenario: scenario.name,
			persona: persona.frontmatter.name,
			target: target.name,
			rubric: rubric.name,
			repeat_index: index,
			repeat_total: total,
			status: "PENDING",
			started_at: at.toISOString(),
			turns_used: 0,
			max_turns: scenario.max_turns,
			models: { simulator: settings.models.simulator, judge: settings.models.judge },
		};
		await this.deps.runStore.create(record);
		return record;
	}

	private async schedule(job: Job): Promise<void> {
		const release = await this.semaphore.acquire();
		let final: RunRecord = job.record;
		try {
			final = job.controller.signal.aborted
				? await this.finishCancelled(job)
				: await this.execute(job);
		} catch (error) {
			this.logger.error(`[${job.record.id}] unexpected runner failure: ${errorMessage(error)}`);
			try {
				final = await this.fail(job, errorMessage(error));
			} catch {
				// The run directory is unusable; the in-memory record is the best we have.
			}
		} finally {
			release();
			job.finished = true;
			this.jobs.delete(job.record.id);
			job.finish(final);
		}
	}

	/** Appends to `events.jsonl` first, then notifies subscribers (SSE history relies on it). */
	private emitter(runId: string): (event: RunEventInput) => Promise<void> {
		let chain = Promise.resolve();
		return (input) => {
			const event = { ...input, runId, at: this.now().toISOString() } as RunEvent;
			chain = chain.then(async () => {
				await this.deps.runStore.appendEvent(runId, event);
				for (const listener of this.listeners.get(runId) ?? []) {
					try {
						listener(event);
					} catch (error) {
						this.logger.warn(`[${runId}] event listener threw: ${errorMessage(error)}`);
					}
				}
			});
			return chain;
		};
	}

	private async execute(job: Job): Promise<RunRecord> {
		const { id } = job.record;
		const emit = this.emitter(id);
		const ctx: RunContext = {
			runId: id,
			resolved: job.resolved,
			runStore: this.deps.runStore,
			browserFactory: this.deps.browserFactory,
			models: job.models,
			headless: job.headless,
			workspaceRoot: this.deps.workspace.root,
			signal: job.controller.signal,
			logger: this.logger,
			now: this.now,
		};

		const running = await this.deps.runStore.updateRecord(id, { status: "RUNNING" });
		await emit({ type: "run_started", run: running });
		await emit({ type: "status", status: "RUNNING" });
		this.logger.info(
			`[${id}] started (${job.record.scenario} ${job.record.repeat_index}/${job.record.repeat_total})`,
		);

		const state: Partial<RunGraphStateType> = {};
		let failure: string | undefined;
		try {
			const stream = await buildRunGraph(ctx).stream(
				{ runId: id, resolved: job.resolved },
				{ streamMode: ["updates", "custom"], signal: job.controller.signal },
			);
			for await (const chunk of stream) {
				const [mode, payload] = chunk as [string, unknown];
				if (mode === "custom") {
					await emit(payload as RunEventInput);
				} else if (mode === "updates" && payload && typeof payload === "object") {
					for (const update of Object.values(
						payload as Record<string, Partial<RunGraphStateType>>,
					)) {
						Object.assign(state, update);
					}
				}
			}
		} catch (error) {
			failure = errorMessage(error);
		}

		if (job.controller.signal.aborted) failure = "cancelled";
		else if (state.error !== undefined) failure = state.error;

		if (failure === undefined) {
			const record = await this.deps.runStore.readRecord(id);
			this.logger.info(`[${id}] ${record.status} (score ${record.score ?? "n/a"})`);
			return record;
		}
		await releaseBrowser(ctx);
		return this.fail(job, failure, emit);
	}

	private async finishCancelled(job: Job): Promise<RunRecord> {
		return this.fail(job, "cancelled");
	}

	private async fail(
		job: Job,
		message: string,
		emit = this.emitter(job.record.id),
	): Promise<RunRecord> {
		const { id } = job.record;
		this.logger.warn(`[${id}] ERROR: ${message}`);
		const record = await this.deps.runStore.updateRecord(id, {
			status: "ERROR",
			error: message,
			finished_at: this.now().toISOString(),
		});
		await emit({ type: "status", status: "ERROR" });
		await emit({ type: "error", message, fatal: true });
		return record;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** Creates the filesystem-backed {@link Runner}; see {@link RunnerDeps} for the wiring. */
export function createRunner(deps: RunnerDeps): RunnerHandle {
	return new FsRunner(deps);
}
