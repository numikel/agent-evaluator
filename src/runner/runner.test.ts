import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BaseMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { minimalPdf } from "../agents/judge/test-fixtures.js";
import { ProviderNotConfiguredError } from "../config/types.js";
import type { RunEvent } from "../schemas/index.js";
import { FakeBrowserSession } from "../testing/fake-browser-session.js";
import { ScriptedChatModel, type ScriptedTurn } from "../testing/scripted-chat-model.js";
import { createRunner, type RunnerHandle } from "./index.js";
import {
	editResource,
	FakeSessionFactory,
	makeTempWorkspace,
	ScriptedModelFactory,
	SlowFakeSession,
	type TempWorkspace,
} from "./testing.js";
import { RunPreconditionError } from "./types.js";

const SCENARIO = "invoice-export-september";
const TARGET_URL = "http://localhost:3999";
const BOT_REPLY =
	"Here is your invoice for September 2026 (customer 4471). Click Download to save the PDF.";

const call = (name: string, args: Record<string, unknown> = {}): ScriptedTurn => ({
	toolCalls: [{ name, args }],
});
const sendMessage = (text: string) => call("send_message", { text });
const endConversation = (reason: "goal_reached" | "gave_up" | "blocked", summary = "done") =>
	call("end_conversation", { reason, summary });

type JudgeOutput = { score: number; pass: boolean; reason: string; evidence: unknown[] };
const out = (score: number, pass: boolean, reason = "scripted"): JudgeOutput => ({
	score,
	pass,
	reason,
	evidence: [],
});

/** Selector pick + the four template LLM criteria (goal_reached, tone, no_hallucinated_data, stays_on_task). */
const judgeScript = (goalReached: boolean) => [
	{ steps: [2] },
	out(goalReached ? 1 : 0, goalReached, goalReached ? "PDF downloaded." : "No PDF confirmed."),
	out(4, true),
	out(1, true),
	out(5, true),
];

const judgeModel = (goalReached = true) =>
	new ScriptedChatModel({ script: [], structured: judgeScript(goalReached) });

const eventTypes = (events: RunEvent[]): string[] =>
	events.map((e) => (e.type === "status" ? `status:${e.status}` : e.type));

function systemText(messages: BaseMessage[] | undefined): string {
	return messages?.find((m) => m.getType() === "system")?.text ?? "";
}

async function makePdfDownload(): Promise<{
	filename: string;
	path: string;
	mime: string;
	bytes: number;
}> {
	const dir = await mkdtemp(join(tmpdir(), "ae-dl-"));
	const path = join(dir, "invoice-september-2026.pdf");
	const pdf = minimalPdf("Invoice INV-2026-09 for September 2026, customer 4471, total 120.00 EUR");
	await writeFile(path, pdf);
	return {
		filename: "invoice-september-2026.pdf",
		path,
		mime: "application/pdf",
		bytes: pdf.length,
	};
}

describe("createRunner", () => {
	let ws: TempWorkspace;
	let runner: RunnerHandle | undefined;

	beforeEach(async () => {
		ws = await makeTempWorkspace();
		runner = undefined;
	});

	afterEach(async () => {
		await runner?.close();
		await ws.cleanup();
	});

	it("seam 1: happy path produces a PASSED run with every artifact and an ordered event log", async () => {
		const download = await makePdfDownload();
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: [BOT_REPLY], downloads: [download] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [
						call("snapshot"),
						sendMessage("need my invoice for september, customer 4471"),
						call("download", { ref: "e5" }),
						endConversation("goal_reached", "Got the PDF."),
					],
					strict: true,
				}),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});

		const { runIds } = await runner.start({ scenario: SCENARIO });
		expect(runIds).toHaveLength(1);
		const runId = runIds[0] as string;
		expect(runId).toMatch(/^\d{8}-\d{6}-invoice-export-september-[0-9a-f]{4}$/);

		// Every live event must already be on disk when listeners see it (SSE history depends on it).
		const seen: RunEvent[] = [];
		const notPersistedYet: string[] = [];
		runner.subscribe(runId, (event) => {
			seen.push(event);
			const lines = readFileSync(join(ws.runStore.dir(runId), "events.jsonl"), "utf8")
				.trim()
				.split("\n");
			const last = JSON.parse(lines.at(-1) ?? "null");
			if (JSON.stringify(last) !== JSON.stringify(event)) notPersistedYet.push(event.type);
		});

		const record = await runner.wait(runId);
		expect(notPersistedYet).toEqual([]);

		expect(record).toMatchObject({
			id: runId,
			scenario: SCENARIO,
			persona: "impatient-smb-owner",
			target: "demo-chatbot",
			rubric: "customer-support",
			status: "PASSED",
			turns_used: 1,
			max_turns: 6,
			repeat_index: 1,
			repeat_total: 1,
			simulator_outcome: { reason: "goal_reached", summary: "Got the PDF." },
			models: { simulator: "anthropic:claude-sonnet-5-5", judge: "anthropic:claude-sonnet-5-5" },
		});
		expect(record.finished_at).toBeDefined();
		expect(record.score).toBeGreaterThan(0.7);
		expect(record.error).toBeUndefined();

		const verdict = await ws.runStore.readVerdict(runId);
		expect(verdict?.status).toBe("PASSED");
		expect(verdict?.goal_reached).toBe(true);
		expect(verdict?.criteria.find((c) => c.id === "pdf_delivered")?.pass).toBe(true);
		expect(verdict?.criteria.find((c) => c.id === "mentions_month")?.pass).toBe(true);
		expect(verdict?.evidence_screenshots).toEqual(["steps/002/after.png"]);

		const dir = ws.runStore.dir(runId);
		for (const file of [
			"run.json",
			"scenario.snapshot.yaml",
			"events.jsonl",
			"transcript.jsonl",
			"verdict.json",
			"report.html",
			"summary.json",
			"junit.xml",
			"downloads.json",
			"downloads/invoice-september-2026.pdf",
			"steps/001/action.json",
			"steps/001/before.png",
			"steps/001/after.png",
			"steps/001/snapshot.txt",
			"steps/002/action.json",
			"steps/002/snapshot.txt",
			"steps/002/interim-1.png",
			"steps/003/action.json",
			"steps/004/action.json",
		]) {
			expect(existsSync(join(dir, file)), `${file} should exist`).toBe(true);
		}
		expect(existsSync(join(dir, "steps/005"))).toBe(false);

		const steps = await ws.runStore.readSteps(runId);
		expect(steps.map((s) => [s.index, s.turn, s.action.kind])).toEqual([
			[1, 1, "snapshot"],
			[2, 1, "send_message"],
			[3, 2, "download"],
			[4, 1, "end_conversation"],
		]);
		expect(steps[1]?.result).toBe(BOT_REPLY);
		expect(steps[1]?.duration_ms).toBeGreaterThanOrEqual(0);

		const transcript = await ws.runStore.readTranscript(runId);
		expect(transcript.map((e) => `${e.turn}:${e.role}`)).toEqual(["1:user", "1:bot"]);

		const downloads = await ws.runStore.readDownloads(runId);
		expect(downloads).toHaveLength(1);
		expect(downloads[0]).toMatchObject({
			path: "downloads/invoice-september-2026.pdf",
			mime: "application/pdf",
			bytes: download.bytes,
			step: 3,
			turn: 1,
		});
		expect(downloads[0]?.text_excerpt).toContain("INV-2026-09");

		const report = await readFile(join(dir, "report.html"), "utf8");
		expect(report).toContain("PASSED");
		expect(report).toContain("data:image/png;base64,");
		const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
		expect(summary).toMatchObject({ runId, status: "PASSED" });
		expect(await readFile(join(dir, "scenario.snapshot.yaml"), "utf8")).toContain(
			"name: invoice-export-september",
		);

		// Event log: persisted and live views are identical and ordered.
		const persisted = (await readFile(join(dir, "events.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as RunEvent);
		expect(persisted).toEqual(seen);
		const types = eventTypes(persisted);
		expect(types.slice(0, 2)).toEqual(["run_started", "status:RUNNING"]);
		expect(types.at(-1)).toBe("done");
		expect(types.at(-2)).toBe("status:PASSED");
		expect(types.indexOf("status:JUDGING")).toBeGreaterThan(types.lastIndexOf("step"));
		expect(types.indexOf("judge_started")).toBe(types.indexOf("status:JUDGING") + 1);
		expect(types.filter((t) => t === "criterion")).toHaveLength(8);
		expect(types.filter((t) => t === "step")).toHaveLength(4);
		expect(types.filter((t) => t === "message")).toHaveLength(2);
		expect(types.filter((t) => t === "download")).toHaveLength(1);
		expect(types.indexOf("turn")).toBeLessThan(types.indexOf("message"));
		const started = persisted[0];
		expect(started?.type === "run_started" && started.run.status).toBe("RUNNING");
		const turn = persisted.find((e) => e.type === "turn");
		expect(turn?.type === "turn" && [turn.turn, turn.max_turns]).toEqual([1, 6]);
		const judgeStarted = persisted.find((e) => e.type === "judge_started");
		expect(judgeStarted?.type === "judge_started" && judgeStarted.criteria).toContain(
			"goal_reached",
		);
		const done = persisted.at(-1);
		expect(done?.type === "done" && done.report).toBe("report.html");
		expect(done?.type === "done" && done.verdict.status).toBe("PASSED");

		// Browser lifecycle: opened at the target URL with the target viewport, closed at the end.
		const session = factory.sessions[0] as FakeBrowserSession;
		expect(session.calls[0]).toEqual({ method: "open", args: [TARGET_URL] });
		expect(session.closed).toBe(true);
		expect(factory.options[0]).toMatchObject({
			headless: true,
			viewport: { width: 1280, height: 800 },
			navigationTimeoutMs: 30_000,
		});
		expect(await runner.active()).toEqual([]);
	});

	it("seam 2: max_turns exhaustion is judged and ends FAILED with simulator_outcome max_turns", async () => {
		await editResource(ws.workspace, "scenario", SCENARIO, (raw) =>
			raw.replace("max_turns: 6", "max_turns: 2"),
		);
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: ["one", "two", "three"] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () => new ScriptedChatModel({ script: [sendMessage("again")] }),
			judge: () => judgeModel(false),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});

		const { runIds } = await runner.start({ scenario: SCENARIO });
		const record = await runner.wait(runIds[0] as string);

		expect(record.status).toBe("FAILED");
		expect(record.turns_used).toBe(2);
		expect(record.max_turns).toBe(2);
		expect(record.simulator_outcome?.reason).toBe("max_turns");
		const verdict = await ws.runStore.readVerdict(runIds[0] as string);
		expect(verdict?.status).toBe("FAILED");
		expect(verdict?.goal_reached).toBe(false);
		expect(verdict?.turns_used).toBe(2);
		expect(verdict?.criteria).toHaveLength(8);
	});

	it("forces FAILED when max_turns is exhausted even if the judge claims the goal was reached", async () => {
		await editResource(ws.workspace, "scenario", SCENARIO, (raw) =>
			raw.replace("max_turns: 6", "max_turns: 2"),
		);
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: ["one", "two", "three"] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () => new ScriptedChatModel({ script: [sendMessage("again")] }),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});

		const { runIds } = await runner.start({ scenario: SCENARIO });
		const record = await runner.wait(runIds[0] as string);

		expect(record.simulator_outcome?.reason).toBe("max_turns");
		expect(record.status).toBe("FAILED");
		const verdict = await ws.runStore.readVerdict(runIds[0] as string);
		expect(verdict?.status).toBe("FAILED");
		expect(verdict?.goal_reached).toBe(false);
		const goal = verdict?.criteria.find((c) => c.id === "goal_reached");
		expect(goal).toMatchObject({ pass: false, score: 0 });
		expect(goal?.reason).toMatch(/turn budget/i);
		expect(verdict?.goal_assessment).toMatch(/turn budget/i);
	});

	it("seam 3: a browser failure during open ends ERROR with a fatal event, no verdict, session closed", async () => {
		const factory = new FakeSessionFactory({
			make: () => new SlowFakeSession({ failOpen: "net::ERR_CONNECTION_REFUSED" }),
		});
		const models = new ScriptedModelFactory({
			simulator: () => new ScriptedChatModel({ script: [], strict: true }),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});

		const { runIds } = await runner.start({ scenario: SCENARIO });
		const runId = runIds[0] as string;
		const events: RunEvent[] = [];
		runner.subscribe(runId, (e) => {
			events.push(e);
		});
		const record = await runner.wait(runId);

		expect(record.status).toBe("ERROR");
		expect(record.error).toContain("ERR_CONNECTION_REFUSED");
		expect(record.finished_at).toBeDefined();
		expect(await ws.runStore.readVerdict(runId)).toBeUndefined();
		expect(existsSync(join(ws.runStore.dir(runId), "report.html"))).toBe(false);
		const last = events.at(-1);
		expect(last?.type).toBe("error");
		expect(last?.type === "error" && last.fatal).toBe(true);
		expect(last?.type === "error" && last.message).toContain("ERR_CONNECTION_REFUSED");
		expect(eventTypes(events)).toContain("status:ERROR");
		expect(factory.sessions[0]?.closed).toBe(true);
		expect(factory.alive).toBe(0);
		expect(models.models("judge")[0]?.callCount).toBe(0);
	});

	it("seam 4: repeat 3 with concurrency 2 runs three times with at most two sessions alive", async () => {
		await editResource(ws.workspace, "settings", undefined, (raw) =>
			raw.replace("concurrency: 1", "concurrency: 2"),
		);
		const factory = new FakeSessionFactory({
			make: () => new SlowFakeSession({ replies: [BOT_REPLY], replyDelayMs: 80 }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [sendMessage("invoice please"), endConversation("goal_reached")],
					strict: true,
				}),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});

		const { runIds } = await runner.start({ scenario: SCENARIO, repeat: 3 });
		expect(new Set(runIds).size).toBe(3);
		const active = await runner.active();
		expect(active.length).toBeGreaterThan(0);
		expect(active.length).toBeLessThanOrEqual(3);

		const records = await Promise.all(runIds.map((id) => runner?.wait(id)));
		// No PDF is downloaded here, so the required `pdf_delivered` criterion fails every run.
		expect(records.map((r) => r?.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
		for (const id of runIds) expect(await ws.runStore.readVerdict(id)).toBeDefined();
		expect(records.map((r) => [r?.repeat_index, r?.repeat_total])).toEqual([
			[1, 3],
			[2, 3],
			[3, 3],
		]);
		expect(factory.sessions).toHaveLength(3);
		expect(factory.maxAlive).toBe(2);
		expect(factory.alive).toBe(0);
		expect(await runner.active()).toEqual([]);
		expect((await ws.runStore.list()).map((r) => r.id).sort()).toEqual([...runIds].sort());
	});

	it("expands scenario.repeat × request.repeat", async () => {
		await editResource(ws.workspace, "scenario", SCENARIO, (raw) =>
			raw.replace("repeat: 1", "repeat: 2"),
		);
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: [BOT_REPLY] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [sendMessage("invoice please"), endConversation("goal_reached")],
				}),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO, repeat: 2 });
		expect(runIds).toHaveLength(4);
		const records = await Promise.all(runIds.map((id) => runner?.wait(id)));
		expect(records.map((r) => r?.repeat_total)).toEqual([4, 4, 4, 4]);
	});

	it("seam 5: cancel mid-conversation ends ERROR/cancelled and closes the session", async () => {
		const factory = new FakeSessionFactory({
			make: () => new SlowFakeSession({ replyDelayMs: Number.POSITIVE_INFINITY }),
		});
		const models = new ScriptedModelFactory({
			simulator: () => new ScriptedChatModel({ script: [sendMessage("hello?")] }),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});

		const { runIds } = await runner.start({ scenario: SCENARIO });
		const runId = runIds[0] as string;
		const events: RunEvent[] = [];
		runner.subscribe(runId, (e) => {
			events.push(e);
			if (e.type === "message" && e.entry.role === "user") void runner?.cancel(runId);
		});
		const record = await runner.wait(runId);

		expect(record.status).toBe("ERROR");
		expect(record.error).toBe("cancelled");
		expect(record.finished_at).toBeDefined();
		expect(factory.sessions[0]?.closed).toBe(true);
		const last = events.at(-1);
		expect(last?.type === "error" && [last.fatal, last.message]).toEqual([true, "cancelled"]);
		expect(await ws.runStore.readVerdict(runId)).toBeUndefined();
		expect(await runner.active()).toEqual([]);
	});

	it("cancelling a queued run skips it without opening a browser", async () => {
		const factory = new FakeSessionFactory({
			make: () => new SlowFakeSession({ replies: [BOT_REPLY], replyDelayMs: 100 }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [sendMessage("invoice please"), endConversation("goal_reached")],
				}),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO, repeat: 2 });
		const queued = runIds[1] as string;
		await runner.cancel(queued);
		const records = await Promise.all(runIds.map((id) => runner?.wait(id)));
		expect(records[0]?.status).toBe("FAILED");
		expect(await ws.runStore.readVerdict(runIds[0] as string)).toBeDefined();
		expect(records[1]).toMatchObject({ status: "ERROR", error: "cancelled" });
		expect(await ws.runStore.readVerdict(queued)).toBeUndefined();
		expect(factory.sessions).toHaveLength(1);
	});

	it("seam 6: unknown scenario and unconfigured models are RunPreconditionErrors; nothing is written", async () => {
		const factory = new FakeSessionFactory();
		const models = new ScriptedModelFactory({
			simulator: () => new ScriptedChatModel({ script: [] }),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});

		await expect(runner.start({ scenario: "does-not-exist" })).rejects.toBeInstanceOf(
			RunPreconditionError,
		);
		await expect(runner.start({ scenario: "does-not-exist" })).rejects.toThrow(/not found/);
		await expect(runner.start({ scenario: SCENARIO, target: "nope" })).rejects.toBeInstanceOf(
			RunPreconditionError,
		);

		models.failure = new ProviderNotConfiguredError("anthropic", "ANTHROPIC_API_KEY");
		await expect(runner.start({ scenario: SCENARIO })).rejects.toBeInstanceOf(RunPreconditionError);
		await expect(runner.start({ scenario: SCENARIO })).rejects.toThrow(/ANTHROPIC_API_KEY/);

		expect(await ws.runStore.list()).toEqual([]);
		expect(factory.sessions).toHaveLength(0);
	});

	it("maps simulator reason blocked to judging (status from the verdict)", async () => {
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: [BOT_REPLY] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [sendMessage("hi"), endConversation("blocked", "The widget froze.")],
				}),
			judge: () => judgeModel(false),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO });
		const record = await runner.wait(runIds[0] as string);
		expect(record.simulator_outcome).toEqual({ reason: "blocked", summary: "The widget froze." });
		expect(record.status).toBe("FAILED");
		expect(await ws.runStore.readVerdict(runIds[0] as string)).toBeDefined();
	});

	it("maps a simulator error to ERROR without judging", async () => {
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: [BOT_REPLY] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () => new ScriptedChatModel({ script: [], strict: true }),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO });
		const record = await runner.wait(runIds[0] as string);
		expect(record.status).toBe("ERROR");
		expect(record.error).toMatch(/script exhausted/);
		expect(record.simulator_outcome?.reason).toBe("error");
		expect(await ws.runStore.readVerdict(runIds[0] as string)).toBeUndefined();
		expect(factory.sessions[0]?.closed).toBe(true);
	});

	it("maps a judge failure to ERROR after the conversation was recorded", async () => {
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: [BOT_REPLY] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [sendMessage("hi"), endConversation("goal_reached")],
				}),
			judge: () => new ScriptedChatModel({ script: [], structured: [] }),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO });
		const runId = runIds[0] as string;
		const events: RunEvent[] = [];
		runner.subscribe(runId, (e) => {
			events.push(e);
		});
		const record = await runner.wait(runId);
		expect(record.status).toBe("ERROR");
		expect(record.error).toMatch(/structured script exhausted/);
		expect(record.turns_used).toBe(1);
		expect(eventTypes(events)).toContain("status:JUDGING");
		expect(await ws.runStore.readVerdict(runId)).toBeUndefined();
		expect((await ws.runStore.readTranscript(runId)).length).toBe(2);
	});

	it("runs login_steps as a turn-0 simulator pass before the conversation", async () => {
		await editResource(ws.workspace, "target", "demo-chatbot", (raw) =>
			raw.replace("# auth:\n", 'auth:\n  login_steps: Click "Sign in" and submit the form.\n'),
		);
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: [BOT_REPLY] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [
						call("click", { ref: "e2" }),
						endConversation("goal_reached", "Logged in."),
						sendMessage("invoice please"),
						endConversation("goal_reached", "Got it."),
					],
					strict: true,
				}),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO });
		const runId = runIds[0] as string;
		const record = await runner.wait(runId);

		expect(record.status).toBe("FAILED");
		expect(record.simulator_outcome).toEqual({ reason: "goal_reached", summary: "Got it." });
		expect(record.turns_used).toBe(1);
		const steps = await ws.runStore.readSteps(runId);
		expect(steps.map((s) => [s.turn, s.action.kind])).toEqual([
			[0, "click"],
			[0, "end_conversation"],
			[1, "send_message"],
			[1, "end_conversation"],
		]);
		const simulator = models.models("simulator")[0] as ScriptedChatModel;
		expect(systemText(simulator.calls[0])).toContain('Click "Sign in"');
		expect(systemText(simulator.calls[2])).not.toContain('Click "Sign in"');
		expect((await ws.runStore.readTranscript(runId)).map((e) => e.role)).toEqual(["user", "bot"]);
	});

	it("honours the headless override and settings.browser", async () => {
		await editResource(ws.workspace, "settings", undefined, (raw) =>
			raw.replace("slow_mo_ms: 0", "slow_mo_ms: 25"),
		);
		const factory = new FakeSessionFactory({
			make: () => new FakeBrowserSession({ replies: [BOT_REPLY] }),
		});
		const models = new ScriptedModelFactory({
			simulator: () =>
				new ScriptedChatModel({
					script: [sendMessage("hi"), endConversation("goal_reached")],
				}),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO, headless: false });
		await runner.wait(runIds[0] as string);
		expect(factory.options[0]).toMatchObject({ headless: false, slowMoMs: 25 });
		const downloadDir = factory.options[0]?.downloadDir as string;
		await expect(stat(downloadDir)).rejects.toThrow();
	});

	it("close() cancels in-flight runs and closes the browser factory", async () => {
		const factory = new FakeSessionFactory({
			make: () => new SlowFakeSession({ replyDelayMs: Number.POSITIVE_INFINITY }),
		});
		const models = new ScriptedModelFactory({
			simulator: () => new ScriptedChatModel({ script: [sendMessage("hello?")] }),
			judge: () => judgeModel(true),
		});
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: factory,
			modelFactory: models,
		});
		const { runIds } = await runner.start({ scenario: SCENARIO });
		const runId = runIds[0] as string;
		await new Promise<void>((resolve) => {
			runner?.subscribe(runId, (e) => {
				if (e.type === "message") resolve();
			});
		});
		await runner.close();
		expect(factory.closed).toBe(true);
		expect((await ws.runStore.readRecord(runId)).status).toBe("ERROR");
		expect(await runner.active()).toEqual([]);
	});
});
