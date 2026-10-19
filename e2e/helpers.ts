/**
 * Shared plumbing for the E2E suite: the demo chatbot on a free port, a throwaway workspace made
 * from the shipped templates with `target.url` rewritten to that port, scripted simulator/judge
 * models and a runner over the real `PlaywrightSessionFactory`.
 *
 * Chromium comes from `AE_CHROMIUM_PATH` when set, else Playwright's default build (CI). Set
 * `AE_E2E_WORKSPACE_DIR` to create the workspaces under a known directory and `AE_E2E_KEEP=1` to
 * keep them after the tests (CI uploads `runs/**` on failure).
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BaseMessage } from "@langchain/core/messages";
import { type DemoServer, startDemo } from "../fixtures/demo-chatbot/server.js";
import {
	createRunner,
	openRunStore,
	openWorkspace,
	PlaywrightSessionFactory,
	type RunnerHandle,
	type RunRecord,
	type RunStore,
	ScriptedChatModel,
	type Workspace,
} from "../src/index.js";
import { editResource, ScriptedModelFactory } from "../src/runner/testing.js";
import type { ScriptedTurn, ToolCallScript } from "../src/testing/scripted-chat-model.js";

export const SCENARIO = "invoice-export-september";
export const TARGET = "demo-chatbot";
export const USER_MESSAGE = "need my invoice for september, customer 4471";

export type DemoMode = "normal" | "slow" | "offtopic" | "broken" | "noattach";

export type WorkspaceOptions = {
	/** Failure mode of the demo chatbot, appended to the target URL as `?mode=…`. */
	mode?: DemoMode;
	/** `target.timeouts.response_ms`; small values keep the `broken` mode test fast. */
	responseMs?: number;
	/** `scenario.max_turns` of the invoice scenario. */
	maxTurns?: number;
};

export type E2eWorkspace = {
	root: string;
	workspace: Workspace;
	runStore: RunStore;
	cleanup: () => Promise<void>;
};

const STABLE_MS = 600;
const CAPTURE_INTERVAL_MS = 300;
const DEFAULT_RESPONSE_MS = 15_000;

/** Replaces the scalar of a `key:` line (any indentation), keeping any trailing comment. */
export function setScalar(raw: string, key: string, value: string | number): string {
	const pattern = new RegExp(`^([ \\t]*${key}:[ \\t]*)[^#\\n]*?([ \\t]*(?:#.*)?)$`, "m");
	if (!pattern.test(raw)) throw new Error(`template has no '${key}:' line to rewrite`);
	return raw.replace(pattern, `$1${value}$2`);
}

export function demoTargetUrl(demo: Pick<DemoServer, "url">, mode: DemoMode = "normal"): string {
	return mode === "normal" ? demo.url : `${demo.url}/?mode=${mode}`;
}

/** A workspace initialised from the templates, pointed at `demo` with fast timeouts. */
export async function makeE2eWorkspace(
	demo: Pick<DemoServer, "url">,
	options: WorkspaceOptions = {},
): Promise<E2eWorkspace> {
	const baseDir = process.env.AE_E2E_WORKSPACE_DIR
		? resolve(process.env.AE_E2E_WORKSPACE_DIR)
		: tmpdir();
	await mkdir(baseDir, { recursive: true });
	const root = await mkdtemp(join(baseDir, "ae-e2e-"));
	const workspace = openWorkspace(root);
	await workspace.init();
	await editResource(workspace, "target", TARGET, (raw) => {
		let next = setScalar(raw, "url", demoTargetUrl(demo, options.mode));
		next = setScalar(next, "response_ms", options.responseMs ?? DEFAULT_RESPONSE_MS);
		next = setScalar(next, "stable_ms", STABLE_MS);
		return setScalar(next, "capture_interval_ms", CAPTURE_INTERVAL_MS);
	});
	if (options.maxTurns !== undefined) {
		const maxTurns = options.maxTurns;
		await editResource(workspace, "scenario", SCENARIO, (raw) =>
			setScalar(raw, "max_turns", maxTurns),
		);
	}
	const settings = await workspace.loadSettings();
	const runStore = openRunStore(join(root, settings.runs_dir));
	return {
		root,
		workspace,
		runStore,
		cleanup: async () => {
			if (process.env.AE_E2E_KEEP === "1") return;
			await rm(root, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------------------------------------
// Scripted models
// ---------------------------------------------------------------------------------------------

type TurnSpec = { text?: string; toolCalls?: ToolCallScript[] };

export const call = (name: string, args: Record<string, unknown> = {}): TurnSpec => ({
	toolCalls: [{ name, args }],
});

/** Text of the latest tool result the model received (the snapshot or the bot reply). */
export function lastToolText(messages: BaseMessage[]): string {
	const tool = messages.filter((m) => m.getType() === "tool").at(-1);
	return typeof tool?.content === "string" ? tool.content : JSON.stringify(tool?.content ?? "");
}

/** Clicks the `button "Download"` of the latest snapshot, or gives up when the bot offered none. */
export const downloadFromSnapshot: ScriptedTurn = (messages) => {
	const match = /button "Download"[^\n]*\[ref=([a-z0-9]+)\]/.exec(lastToolText(messages));
	if (!match?.[1]) {
		return call("end_conversation", {
			reason: "gave_up",
			summary: "The bot did not offer a Download button.",
		});
	}
	return call("download", { ref: match[1] });
};

/** snapshot → send_message → snapshot → download → end_conversation(goal_reached). */
export const happyPathScript: ScriptedTurn[] = [
	call("snapshot"),
	call("send_message", { text: USER_MESSAGE }),
	call("snapshot"),
	downloadFromSnapshot,
	call("end_conversation", { reason: "goal_reached", summary: "Downloaded the September PDF." }),
];

/** Keeps sending messages and never ends the conversation (exhausts `max_turns`). */
export const chattyScript: ScriptedTurn[] = [
	call("snapshot"),
	call("send_message", { text: USER_MESSAGE }),
	call("send_message", { text: "hello? still waiting for that pdf" }),
	call("send_message", { text: "anyone there?" }),
];

type JudgeOutput = { score: number; pass: boolean; reason: string; evidence: unknown[] };
const score = (value: number, pass: boolean, reason: string): JudgeOutput => ({
	score: value,
	pass,
	reason,
	evidence: [],
});

/**
 * Structured outputs the judge consumes in order: the evidence selection, then the LLM criteria
 * in rubric order (`goal_reached`, `tone`, `no_hallucinated_data`, `stays_on_task`).
 */
export function judgeOutputs(options: {
	goalReached: boolean;
	evidenceSteps?: number[];
}): unknown[] {
	const { goalReached } = options;
	return [
		{ steps: options.evidenceSteps ?? [2] },
		score(
			goalReached ? 1 : 0,
			goalReached,
			goalReached ? "The September PDF was downloaded." : "No PDF was downloaded.",
		),
		score(4, true, "Polite and brief."),
		score(1, true, "No invented data."),
		score(5, true, "Stayed on task."),
	];
}

export type ScriptedModelsOptions = {
	simulator?: ScriptedTurn[];
	/** `false` lets the last simulator turn repeat once the script is exhausted. */
	strict?: boolean;
	judge?: unknown[];
};

/** A `ModelFactory` handing out fresh scripted simulator/judge models per run. */
export function scriptedModels(options: ScriptedModelsOptions = {}): ScriptedModelFactory {
	const script = options.simulator ?? happyPathScript;
	const structured = options.judge ?? judgeOutputs({ goalReached: true, evidenceSteps: [2, 4] });
	return new ScriptedModelFactory({
		simulator: () => new ScriptedChatModel({ script, strict: options.strict ?? true }),
		judge: () => new ScriptedChatModel({ script: [], structured }),
	});
}

// ---------------------------------------------------------------------------------------------
// Demo server + runner lifecycle
// ---------------------------------------------------------------------------------------------

export type E2eContext = {
	demo: DemoServer;
	ws: E2eWorkspace;
	models: ScriptedModelFactory;
	runner: RunnerHandle;
	/** Closes the browser(s) and the demo server, then removes the workspace; never throws. */
	cleanup: () => Promise<void>;
};

export type E2eContextOptions = WorkspaceOptions & ScriptedModelsOptions;

/** Starts a demo server and a scripted runner over a fresh workspace for one test. */
export async function setupE2e(options: E2eContextOptions = {}): Promise<E2eContext> {
	const demo = await startDemo(0);
	let ws: E2eWorkspace;
	try {
		ws = await makeE2eWorkspace(demo, options);
	} catch (error) {
		await demo.close().catch(() => undefined);
		throw error;
	}
	const models = scriptedModels(options);
	const runner = createRunner({
		workspace: ws.workspace,
		runStore: ws.runStore,
		browserFactory: new PlaywrightSessionFactory(),
		modelFactory: models,
	});
	const workspace = ws;
	return {
		demo,
		ws,
		models,
		runner,
		cleanup: async () => {
			await Promise.allSettled([runner.close(), demo.close()]);
			await workspace.cleanup().catch(() => undefined);
		},
	};
}

export type CompletedRun = { runId: string; record: RunRecord; dir: string };

/** Starts `scenario` and waits for its final record. */
export async function runScenario(ctx: E2eContext, scenario = SCENARIO): Promise<CompletedRun> {
	const { runIds } = await ctx.runner.start({ scenario });
	const runId = runIds[0];
	if (!runId) throw new Error("runner.start returned no run id");
	const record = await ctx.runner.wait(runId);
	return { runId, record, dir: ctx.ws.runStore.dir(runId) };
}
