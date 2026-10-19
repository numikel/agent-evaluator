import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReportSummary } from "../../report/index.js";
import type { RunnerHandle } from "../../runner/index.js";
import { makeTempWorkspace, type TempWorkspace } from "../../runner/testing.js";
import type { RunEvent, RunRecord, StartRunRequest } from "../../schemas/index.js";
import {
	createFakeDeps,
	type FakeDeps,
	FakeRunner,
	type InMemoryRunStore,
	type InMemoryWorkspace,
} from "../../server/testing.js";
import { createCliHarness, fakeRunnerFactory } from "../testing.js";

const SCENARIO = "invoice-export-september";
const AT = "2026-10-19T10:00:00.000Z";

type Outcome = {
	status: "PASSED" | "FAILED" | "ERROR";
	score?: number;
	turns?: number;
	error?: string;
};

/** A `FakeRunner` whose `wait` replays scripted events for the run and resolves its final record. */
class ScriptedRunner extends FakeRunner implements RunnerHandle {
	readonly closed: string[] = [];
	closeCalls = 0;
	private readonly outcomes: Outcome[];

	constructor(
		private readonly store: InMemoryRunStore,
		outcomes: Outcome[],
	) {
		super({ runStore: store, now: () => AT });
		this.outcomes = outcomes;
	}

	override async start(request: StartRunRequest): Promise<{ runIds: string[] }> {
		return super.start(request);
	}

	async wait(runId: string): Promise<RunRecord> {
		const index = Number(runId.replace("run-", "")) - 1;
		const outcome = this.outcomes[index] ?? { status: "PASSED", score: 0.87 };
		const base = { runId, at: AT } as const;
		const record = await this.store.readRecord(runId);
		const emit = (event: RunEvent) => this.emit(event);
		emit({ ...base, type: "run_started", run: { ...record, status: "RUNNING" } });
		emit({ ...base, type: "status", status: "RUNNING" });
		emit({ ...base, type: "turn", turn: 1, max_turns: 6 });
		emit({
			...base,
			type: "step",
			step: {
				index: 1,
				turn: 1,
				action: { kind: "send_message", text: "need my invoice for september" },
				interim_screenshots: [],
			},
		});
		emit({
			...base,
			type: "message",
			entry: { turn: 1, role: "bot", text: "Here is your invoice.", at: AT, latency_ms: 120 },
		});
		if (outcome.status === "ERROR") {
			emit({ ...base, type: "status", status: "ERROR" });
			emit({ ...base, type: "error", message: outcome.error ?? "boom", fatal: true });
			return this.store.updateRecord(runId, {
				status: "ERROR",
				error: outcome.error ?? "boom",
				turns_used: 1,
				max_turns: 6,
				finished_at: AT,
			});
		}
		emit({ ...base, type: "status", status: "JUDGING" });
		emit({ ...base, type: "judge_started", criteria: ["goal_reached", "tone"] });
		const goal = outcome.status === "PASSED";
		emit({
			...base,
			type: "criterion",
			result: {
				id: "goal_reached",
				score: goal ? 1 : 0,
				pass: goal,
				weight: 1,
				required: true,
				reason: goal ? "PDF downloaded." : "No PDF confirmed.",
				evidence: [],
			},
		});
		emit({
			...base,
			type: "criterion",
			result: {
				id: "tone",
				score: 0.8,
				pass: true,
				weight: 1,
				required: false,
				reason: "ok",
				evidence: [],
			},
		});
		const score = outcome.score ?? (goal ? 0.87 : 0.4);
		const turns = outcome.turns ?? 2;
		const verdict = {
			runId,
			status: outcome.status,
			goal_reached: goal,
			score,
			pass_threshold: 0.7,
			turns_used: turns,
			max_turns: 6,
			criteria: [],
			summary: "scripted",
			judged_at: AT,
			judge_model: "fake:model",
			evidence_screenshots: [],
		};
		const final = await this.store.updateRecord(runId, {
			status: outcome.status,
			score,
			turns_used: turns,
			max_turns: 6,
			finished_at: AT,
		});
		const summary: ReportSummary = {
			runId,
			scenario: final.scenario,
			status: outcome.status,
			score,
			percent: Math.round(score * 100),
			pass_threshold: 0.7,
			goal_reached: goal,
			turns_used: turns,
			max_turns: 6,
			criteria: [{ id: "goal_reached", score: goal ? 1 : 0, pass: goal, required: true }],
			started_at: final.started_at,
			finished_at: AT,
		};
		await this.store.saveReport(runId, {
			"report.html": "<html></html>",
			"summary.json": `${JSON.stringify(summary, null, 2)}\n`,
			"junit.xml": "<testsuite/>",
		});
		emit({ ...base, type: "status", status: outcome.status });
		emit({ ...base, type: "done", verdict, report: "report.html" });
		return final;
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
	}
}

/** Copies the shipped templates into the in-memory workspace so `resolve` succeeds. */
async function seed(workspace: InMemoryWorkspace): Promise<void> {
	await workspace.init();
	await workspace.writeRaw("persona", await workspace.template("persona"), "impatient-smb-owner");
	await workspace.writeRaw("scenario", await workspace.template("scenario"), SCENARIO);
	await workspace.writeRaw("rubric", await workspace.template("rubric"), "customer-support");
	await workspace.writeRaw("target", await workspace.template("target"), "demo-chatbot");
}

describe("run (fake runner)", () => {
	let fakes: FakeDeps;
	let runner: ScriptedRunner;

	const harness = (outcomes: Outcome[]) => {
		runner = new ScriptedRunner(fakes.runStore, outcomes);
		return createCliHarness({
			openWorkspace: () => fakes.workspace,
			openRunStore: () => fakes.runStore,
			createRunner: () => runner,
		});
	};

	beforeEach(async () => {
		fakes = createFakeDeps();
		await seed(fakes.workspace);
	});

	it("seam 3: streams progress to stderr and prints a summary table on stdout", async () => {
		const cli = harness([{ status: "PASSED", score: 0.87, turns: 2 }]);
		expect(await cli.run("run", SCENARIO)).toBe(0);

		const stderr = cli.stderr();
		expect(stderr).toContain("turn 1/6");
		expect(stderr).toContain("send message");
		expect(stderr).toContain("bot: Here is your invoice.");
		expect(stderr).toContain("✓ goal_reached");
		expect(stderr).toContain("PASSED 87%");

		const stdout = cli.stdout();
		expect(stdout).toContain("Scenario");
		expect(stdout).toContain("Status");
		expect(stdout).toMatch(
			/invoice-export-september\s+PASSED\s+87%\s+2\/6\s+\/fake-workspace\/runs\/run-1\/report\.html/,
		);
		expect(stdout).toMatch(/1 run: 1 passed/);
		expect(runner.closeCalls).toBe(1);
	});

	it("seam 3: exits 1 when a run FAILED and shows the failing criterion", async () => {
		const cli = harness([{ status: "FAILED", score: 0.4 }]);
		expect(await cli.run("run", SCENARIO)).toBe(1);
		expect(cli.stderr()).toContain("✗ goal_reached");
		expect(cli.stdout()).toMatch(/FAILED\s+40%/);
		expect(cli.stderr()).toMatch(/1 failed/);
		expect(runner.closeCalls).toBe(1);
	});

	it("seam 3: --json prints the summary.json objects as an array and exits 1 on ERROR", async () => {
		const cli = harness([
			{ status: "PASSED", score: 0.9 },
			{ status: "ERROR", error: "target down" },
		]);
		expect(await cli.run("run", SCENARIO, "--repeat", "2", "--json")).toBe(1);

		const parsed = JSON.parse(cli.stdout()) as Array<ReportSummary & { error?: string }>;
		expect(parsed).toHaveLength(2);
		const stored = JSON.parse(
			new TextDecoder().decode(await fakes.runStore.readFile("run-1", "summary.json")),
		);
		expect(parsed[0]).toEqual(stored);
		expect(parsed[1]).toMatchObject({
			runId: "run-2",
			scenario: SCENARIO,
			status: "ERROR",
			score: 0,
			percent: 0,
			pass_threshold: 0.7,
			goal_reached: false,
			criteria: [],
			error: "target down",
		});
		expect(cli.stderr()).toContain("error: target down");
	});

	it("passes --target, --repeat and --headed through to the runner", async () => {
		const cli = harness([{ status: "PASSED" }, { status: "PASSED" }]);
		expect(
			await cli.run("run", SCENARIO, "--target", "demo-chatbot", "--repeat", "2", "--headed"),
		).toBe(0);
		expect(runner.started).toEqual([
			{ scenario: SCENARIO, target: "demo-chatbot", repeat: 2, headless: false },
		]);
	});

	it("exits 1 before starting anything when a scenario cannot be resolved", async () => {
		const cli = harness([]);
		expect(await cli.run("run", SCENARIO, "ghost")).toBe(1);
		expect(cli.stderr()).toMatch(/ghost/);
		expect(runner.started).toEqual([]);
		expect(runner.closeCalls).toBe(0);
	});

	it("--fail-on-error cancels the runs still pending after the first ERROR", async () => {
		const cli = harness([{ status: "ERROR", error: "boom" }, { status: "PASSED" }]);
		expect(await cli.run("run", SCENARIO, "--repeat", "2", "--fail-on-error")).toBe(1);
		expect(runner.cancelled).toContain("run-2");
		expect(cli.stderr()).toContain("--fail-on-error");
	});

	it("rejects a non-numeric --repeat", async () => {
		const cli = harness([]);
		expect(await cli.run("run", SCENARIO, "--repeat", "lots")).toBe(1);
		expect(cli.stderr()).toContain("--repeat");
	});
});

describe("run (real runner over fakes)", () => {
	let ws: TempWorkspace;

	beforeEach(async () => {
		ws = await makeTempWorkspace();
	});

	afterEach(async () => {
		await ws.cleanup();
	});

	it("drives a PASSED run end to end and points at the rendered report", async () => {
		const cli = createCliHarness({ cwd: ws.root, createRunner: fakeRunnerFactory() });
		expect(await cli.run("run", SCENARIO)).toBe(0);

		const stdout = cli.stdout();
		expect(stdout).toMatch(/invoice-export-september\s+PASSED\s+\d+%\s+1\/6/);
		const match = /(\S+\/report\.html)/.exec(stdout);
		expect(match).not.toBeNull();
		expect(existsSync(match?.[1] ?? "")).toBe(true);
		expect(cli.stderr()).toContain("turn 1/6");
		expect(cli.stderr()).toContain("✓ goal_reached");
	});

	it("exits 1 for a FAILED verdict and --json matches the stored summary.json", async () => {
		const cli = createCliHarness({
			cwd: ws.root,
			createRunner: fakeRunnerFactory({ goalReached: false }),
		});
		expect(await cli.run("run", SCENARIO, "--json")).toBe(1);
		const [summary] = JSON.parse(cli.stdout()) as ReportSummary[];
		expect(summary?.status).toBe("FAILED");
		const stored = JSON.parse(
			new TextDecoder().decode(await ws.runStore.readFile(summary?.runId ?? "", "summary.json")),
		);
		expect(summary).toEqual(stored);
	});
});
