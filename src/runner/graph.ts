/**
 * Per-run LangGraph graph (P10): `setup → converse → collect → judge → report`.
 *
 * Nodes never throw: a failure is recorded in `state.error` and the conditional edges route
 * straight to `collect` (which always closes the browser) and then to `END`. Events are pushed
 * through the graph's custom stream writer; the runner persists each one to `events.jsonl`
 * before fanning it out to subscribers, so the order on disk is the order of emission.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	END,
	getWriter,
	type LangGraphRunnableConfig,
	START,
	StateGraph,
} from "@langchain/langgraph";
import { stringify as toYaml } from "yaml";
import { z } from "zod";
import { extractDownloads, judgeRun } from "../agents/judge/index.js";
import { runSimulator } from "../agents/simulator/index.js";
import type {
	BrowserSession,
	BrowserSessionFactory,
	BrowserSessionOptions,
} from "../browser/types.js";
import { renderReport } from "../report/index.js";
import type {
	ConsoleEntry,
	DownloadArtifact,
	RunEvent,
	RunRecord,
	Scenario,
	Target,
	Verdict,
} from "../schemas/index.js";
import { computeOutcome, GOAL_REACHED_CRITERION_ID } from "../schemas/index.js";
import { writeFileAtomic } from "../workspace/fs-utils.js";
import type { ResolvedScenario, RunStore } from "../workspace/types.js";
import { RunStoreStepRecorder } from "./recorder.js";

export type SimulatorOutcome = NonNullable<RunRecord["simulator_outcome"]>;

export type RunModels = {
	simulator: BaseChatModel;
	judge: BaseChatModel;
	/** Evidence selector; the judge model is used when absent. */
	selector?: BaseChatModel;
};

export type RunnerLogger = {
	debug?(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
};

/** Everything one run needs besides its graph state. Mutable fields are owned by the nodes. */
export type RunContext = {
	runId: string;
	resolved: ResolvedScenario;
	runStore: RunStore;
	browserFactory: BrowserSessionFactory;
	models: RunModels;
	headless: boolean;
	/** Base directory for relative paths in the target (e.g. `auth.storage_state`). */
	workspaceRoot: string;
	signal: AbortSignal;
	logger: RunnerLogger;
	now: () => Date;
	/** Opened by `setup`, closed by `collect` (or by the runner after an abort). */
	session?: BrowserSession | undefined;
	/** Temporary directory the browser downloads into before artifacts are moved to `downloads/`. */
	downloadDir?: string | undefined;
	recorder?: RunStoreStepRecorder | undefined;
};

export const RunGraphState = z.object({
	runId: z.string(),
	resolved: z.custom<ResolvedScenario>(),
	turnsUsed: z.number().int().nonnegative().default(0),
	simulatorOutcome: z.custom<SimulatorOutcome>().optional(),
	verdict: z.custom<Verdict>().optional(),
	/** Set by the first failing node; later nodes are skipped except `collect`. */
	error: z.string().optional(),
});
export type RunGraphStateType = z.output<typeof RunGraphState>;
type Update = Partial<RunGraphStateType>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A `RunEvent` without the envelope the graph fills in. */
export type RunEventInput = DistributiveOmit<RunEvent, "runId" | "at">;
export type EmitEvent = (event: RunEventInput) => void;

/**
 * Safety net for the turn budget (plan decision D7): a conversation that exhausted `max_turns`
 * cannot pass, whatever the judge concluded about the goal. The judge's criteria breakdown is kept
 * for diagnostics; only `goal_reached` is forced to fail and the outcome is recomputed.
 */
export function enforceTurnBudget(
	verdict: Verdict,
	outcome: SimulatorOutcome | undefined,
): Verdict {
	if (outcome?.reason !== "max_turns" || !verdict.goal_reached) return verdict;
	const note = `Overridden: the turn budget (${verdict.max_turns}) was exhausted before the simulated user ended the conversation, so the goal counts as not reached.`;
	const criteria = verdict.criteria.map((c) =>
		c.id === GOAL_REACHED_CRITERION_ID
			? { ...c, score: 0, pass: false, reason: `${c.reason} ${note}` }
			: c,
	);
	const { score, status } = computeOutcome({
		criteria,
		goalReached: false,
		passThreshold: verdict.pass_threshold,
	});
	return {
		...verdict,
		criteria,
		goal_reached: false,
		score,
		status,
		goal_assessment: `${verdict.goal_assessment ?? ""} ${note}`.trim(),
	};
}

export const SCENARIO_SNAPSHOT_FILE = "scenario.snapshot.yaml";
export const DOWNLOADS_INDEX_FILE = "downloads.json";
export const REPORT_FILE = "report.html";

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Chromium/Node network error codes that mean "nothing is listening at the target URL". */
const UNREACHABLE_CODES = [
	"ERR_CONNECTION_REFUSED",
	"ERR_CONNECTION_TIMED_OUT",
	"ERR_NAME_NOT_RESOLVED",
	"ERR_ADDRESS_UNREACHABLE",
	"ECONNREFUSED",
] as const;

/**
 * Turns Playwright's `page.goto: net::ERR_CONNECTION_REFUSED at http://…` into an actionable
 * message (start the chatbot, or fix the target file); returns `undefined` for any other failure.
 */
export function unreachableTargetError(target: Target, error: unknown): Error | undefined {
	const message = errorMessage(error);
	const code = UNREACHABLE_CODES.find((c) => message.includes(c));
	if (!code) return undefined;
	return new Error(
		`Target "${target.name}" is not reachable at ${target.url} (${code}). ` +
			"Start the chatbot first - for the built-in demo run `agent-evaluator demo` in another " +
			`terminal - or fix targets/${target.name}.yaml.`,
		{ cause: error },
	);
}

/** Closes the session and removes the temporary download directory. Never throws. */
export async function releaseBrowser(ctx: RunContext): Promise<void> {
	const { session, downloadDir } = ctx;
	ctx.session = undefined;
	ctx.downloadDir = undefined;
	if (session) {
		try {
			await session.close();
		} catch (error) {
			ctx.logger.warn(`[${ctx.runId}] closing the browser session failed: ${errorMessage(error)}`);
		}
	}
	if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
}

function browserOptions(ctx: RunContext, downloadDir: string): BrowserSessionOptions {
	const { target, settings } = ctx.resolved;
	const options: BrowserSessionOptions = {
		headless: ctx.headless,
		viewport: target.viewport,
		downloadDir,
		navigationTimeoutMs: target.timeouts.navigation_ms,
	};
	if (settings.browser.slow_mo_ms > 0) options.slowMoMs = settings.browser.slow_mo_ms;
	const storageState = target.auth?.storage_state;
	if (storageState) {
		options.storageStatePath = isAbsolute(storageState)
			? storageState
			: resolvePath(ctx.workspaceRoot, storageState);
	}
	return options;
}

/** The scenario handed to the simulator for the pre-conversation login pass. */
function loginScenario(ctx: RunContext): Scenario {
	const { scenario, target } = ctx.resolved;
	const auth = target.auth;
	const credentials: string[] = [];
	for (const [field, env] of Object.entries(auth?.credentials_env ?? {})) {
		const value = env ? process.env[env] : undefined;
		if (value !== undefined) credentials.push(`${field}: ${value}`);
	}
	const login: Scenario = {
		name: scenario.name,
		persona: scenario.persona,
		target: scenario.target,
		goal: `Log in to the application before the actual conversation. Instructions: ${auth?.login_steps ?? ""}`,
		intent: "Complete the login flow only; do not start the actual conversation yet.",
		success_criteria:
			"The application shows the logged-in state (the chat or the account area is visible). Call end_conversation with goal_reached as soon as you are logged in, or blocked if the login fails.",
		max_turns: 1,
		examples: [],
		expected_artifacts: [],
		repeat: 1,
		vision: scenario.vision,
		tags: [],
	};
	if (credentials.length > 0) login.context = `Credentials to use: ${credentials.join(", ")}.`;
	return login;
}

async function runLoginPass(
	ctx: RunContext,
	session: BrowserSession,
	recorder: RunStoreStepRecorder,
) {
	recorder.turnOverride = 0;
	try {
		const result = await runSimulator({
			resolved: { ...ctx.resolved, scenario: loginScenario(ctx) },
			session,
			model: ctx.models.simulator,
			recorder,
			signal: ctx.signal,
		});
		if (result.reason !== "goal_reached") {
			throw new Error(`login failed (${result.reason}): ${result.error ?? result.summary}`);
		}
	} finally {
		recorder.turnOverride = undefined;
	}
}

async function readArtifacts(ctx: RunContext) {
	const { runStore, runId } = ctx;
	const [run, steps, transcript, downloads, consoleEntries] = await Promise.all([
		runStore.readRecord(runId),
		runStore.readSteps(runId),
		runStore.readTranscript(runId),
		runStore.readDownloads(runId),
		runStore.readConsole(runId),
	]);
	return { run, steps, transcript, downloads, console: consoleEntries };
}

/** Builds the compiled graph for one run. Nodes read infrastructure from `ctx`, data from state. */
export function buildRunGraph(ctx: RunContext) {
	const { runId, runStore, logger } = ctx;

	const emitter = (config: LangGraphRunnableConfig): EmitEvent => {
		const writer = getWriter(config);
		return (event) => {
			if (ctx.signal.aborted) return;
			try {
				writer?.({ ...event, runId, at: ctx.now().toISOString() } as RunEvent);
			} catch (error) {
				logger.warn(`[${runId}] dropped event ${event.type}: ${errorMessage(error)}`);
			}
		};
	};

	/** Wraps a node so failures land in `state.error` instead of aborting the graph. */
	const node =
		(name: string, body: (state: RunGraphStateType, emit: EmitEvent) => Promise<Update>) =>
		async (state: RunGraphStateType, config: LangGraphRunnableConfig): Promise<Update> => {
			const emit = emitter(config);
			try {
				return await body(state, emit);
			} catch (error) {
				const message = errorMessage(error);
				logger.error(`[${runId}] ${name} failed: ${message}`);
				return { error: message };
			}
		};

	const setup = node("setup", async (state, emit) => {
		const { target, scenario, persona, rubric, evaluator } = state.resolved;
		await writeFileAtomic(
			runStore.artifactPath(runId, SCENARIO_SNAPSHOT_FILE),
			toYaml({ scenario, persona, target, rubric, evaluator }),
		);
		const downloadDir = await mkdtemp(join(tmpdir(), `ae-${runId}-`));
		ctx.downloadDir = downloadDir;
		const session = await ctx.browserFactory.create(browserOptions(ctx, downloadDir));
		ctx.session = session;
		const recorder = new RunStoreStepRecorder({
			runStore,
			runId,
			emit: (event) => emit(event),
			drainConsole: () => session.drainConsole(),
			now: ctx.now,
		});
		ctx.recorder = recorder;

		emit({ type: "log", level: "info", message: `Opening ${target.url}` });
		try {
			await session.open(target.url);
		} catch (error) {
			throw unreachableTargetError(target, error) ?? error;
		}
		if (target.auth?.login_steps) {
			emit({ type: "log", level: "info", message: "Running login steps (turn 0)" });
			await runLoginPass(ctx, session, recorder);
		}
		return {};
	});

	const converse = node("converse", async (state, emit) => {
		const { session, recorder } = ctx;
		if (!session || !recorder) throw new Error("converse: the browser session is not open");
		const { scenario } = state.resolved;
		let currentTurn = 0;
		const result = await runSimulator({
			resolved: state.resolved,
			session,
			model: ctx.models.simulator,
			recorder,
			signal: ctx.signal,
			onMessage: async (entry) => {
				if (entry.role === "user") {
					currentTurn = entry.turn;
					emit({ type: "turn", turn: entry.turn, max_turns: scenario.max_turns });
				}
				await runStore.appendTranscript(runId, entry);
				emit({ type: "message", entry });
			},
			onDownload: async (file, stepId) => {
				const meta: Omit<DownloadArtifact, "path"> = {
					filename: file.filename,
					bytes: file.bytes,
					step: stepId,
					turn: currentTurn,
				};
				if (file.mime !== undefined) meta.mime = file.mime;
				const artifact = await runStore.saveDownload(runId, file.path, meta);
				emit({ type: "download", artifact });
			},
		});
		if (ctx.signal.aborted) return {};
		const simulatorOutcome: SimulatorOutcome = { reason: result.reason, summary: result.summary };
		await runStore.updateRecord(runId, {
			turns_used: result.turnsUsed,
			simulator_outcome: simulatorOutcome,
		});
		const update: Update = { turnsUsed: result.turnsUsed, simulatorOutcome };
		if (result.reason === "error") update.error = result.error ?? result.summary;
		return update;
	});

	const collect = node("collect", async (_state, emit) => {
		const { session } = ctx;
		if (session) {
			try {
				const messages = session.drainConsole();
				if (messages.length > 0) {
					const entries: ConsoleEntry[] = messages.map((m) => ({
						level: m.level,
						text: m.text,
						at: m.at,
					}));
					await runStore.appendConsole(runId, entries);
				}
				for (const failure of session.drainNetworkFailures()) {
					emit({
						type: "log",
						level: "warn",
						message: `Request failed: ${failure.url} (${failure.status ?? failure.error ?? "unknown"})`,
					});
				}
			} catch (error) {
				logger.warn(`[${runId}] collecting browser logs failed: ${errorMessage(error)}`);
			}
		}
		await releaseBrowser(ctx);
		return {};
	});

	const judge = node("judge", async (state, emit) => {
		await runStore.updateRecord(runId, { status: "JUDGING" });
		emit({ type: "status", status: "JUDGING" });
		const artifacts = await readArtifacts(ctx);
		const readFile = (relativePath: string) => runStore.readFile(runId, relativePath);

		// Persist extracted text excerpts so the report and the UI can show them (P7 hand-off).
		let downloads = artifacts.downloads;
		if (downloads.length > 0) {
			downloads = (await extractDownloads(downloads, readFile)).map(
				({ text: _text, error: _error, ...artifact }) => artifact,
			);
			await writeFileAtomic(
				runStore.artifactPath(runId, DOWNLOADS_INDEX_FILE),
				`${JSON.stringify(downloads, null, 2)}\n`,
			);
		}

		emit({ type: "judge_started", criteria: state.resolved.rubric.criteria.map((c) => c.id) });
		const judged = await judgeRun(
			{ ...artifacts, downloads, resolved: state.resolved, readFile },
			{
				judgeModel: ctx.models.judge,
				...(ctx.models.selector ? { selectorModel: ctx.models.selector } : {}),
				now: ctx.now,
				onCriterion: (result) => emit({ type: "criterion", result }),
			},
		);
		const verdict = enforceTurnBudget(judged, state.simulatorOutcome);
		await runStore.saveVerdict(runId, verdict);
		return { verdict };
	});

	const report = node("report", async (state, emit) => {
		const verdict = state.verdict;
		if (!verdict) throw new Error("report: no verdict");
		const { scenario, persona, target, rubric, evaluator } = state.resolved;
		const run = await runStore.updateRecord(runId, {
			status: verdict.status,
			score: verdict.score,
			finished_at: ctx.now().toISOString(),
		});
		const artifacts = await readArtifacts(ctx);
		const files = await renderReport(
			{
				...artifacts,
				run,
				verdict,
				resolved: { scenario, persona: persona.frontmatter, target, rubric, evaluator },
			},
			{
				inlineImages: true,
				imageLoader: async (relativePath) => {
					try {
						return await runStore.readFile(runId, relativePath);
					} catch {
						return undefined;
					}
				},
			},
		);
		await runStore.saveReport(runId, files);
		emit({ type: "status", status: verdict.status });
		emit({ type: "done", verdict, report: REPORT_FILE });
		return {};
	});

	const unlessError = (next: "converse" | "judge" | "report") => (state: RunGraphStateType) =>
		state.error === undefined ? next : next === "converse" ? "collect" : END;

	return new StateGraph(RunGraphState)
		.addNode("setup", setup)
		.addNode("converse", converse)
		.addNode("collect", collect)
		.addNode("judge", judge)
		.addNode("report", report)
		.addEdge(START, "setup")
		.addConditionalEdges("setup", unlessError("converse"), ["converse", "collect"])
		.addEdge("converse", "collect")
		.addConditionalEdges("collect", unlessError("judge"), ["judge", END])
		.addConditionalEdges("judge", unlessError("report"), ["report", END])
		.addEdge("report", END)
		.compile();
}

export type RunGraph = ReturnType<typeof buildRunGraph>;
