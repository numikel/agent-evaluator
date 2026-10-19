import type { RunEvent, RunRecord, Step, Verdict } from "@schemas/run";
import { describe, expect, it } from "vitest";
import * as fx from "../mocks/fixtures.js";
import { applyRunEvent, fromDetail, initialRunState, isTerminalStatus } from "./reducer.js";

const RUN_ID = fx.RUNNING_RUN_ID;
const run = fx.runs.find((r) => r.id === RUN_ID) as RunRecord;
const at = (s: number) => new Date(Date.parse(run.started_at) + s * 1000).toISOString();

const step = (index: number, extra: Partial<Step> = {}): RunEvent => ({
	type: "step",
	runId: RUN_ID,
	at: at(index),
	step: {
		index,
		turn: 1,
		action: { kind: "snapshot" },
		interim_screenshots: [],
		screenshot: `steps/00${index}/after.png`,
		...extra,
	},
});

const apply = (events: RunEvent[]) => events.reduce(applyRunEvent, initialRunState(RUN_ID));

describe("applyRunEvent", () => {
	it("starts empty, pending and with no run record", () => {
		const state = initialRunState(RUN_ID);
		expect(state).toMatchObject({
			runId: RUN_ID,
			status: "PENDING",
			steps: [],
			transcript: [],
			downloads: [],
			criteria: [],
			errors: [],
			logs: [],
		});
		expect(state.run).toBeUndefined();
	});

	it("run_started stores the record, status, turn budget and start time", () => {
		const state = apply([{ type: "run_started", runId: RUN_ID, at: at(0), run }]);
		expect(state.run).toEqual(run);
		expect(state.status).toBe(run.status);
		expect(state.maxTurns).toBe(run.max_turns);
		expect(state.turn).toBe(run.turns_used);
		expect(state.startedAt).toBe(run.started_at);
	});

	it("status moves the status and stamps finishedAt on terminal states only", () => {
		const running = apply([{ type: "status", runId: RUN_ID, at: at(1), status: "RUNNING" }]);
		expect(running.status).toBe("RUNNING");
		expect(running.finishedAt).toBeUndefined();
		const judging = applyRunEvent(running, {
			type: "status",
			runId: RUN_ID,
			at: at(2),
			status: "JUDGING",
		});
		expect(judging.finishedAt).toBeUndefined();
		const failed = applyRunEvent(judging, {
			type: "status",
			runId: RUN_ID,
			at: at(3),
			status: "FAILED",
		});
		expect(failed.status).toBe("FAILED");
		expect(failed.finishedAt).toBe(at(3));
	});

	it("step appends steps in index order and replaces a re-sent index", () => {
		const state = apply([step(2), step(1), step(2, { thought: "again" })]);
		expect(state.steps.map((s) => s.index)).toEqual([1, 2]);
		expect(state.steps[1]?.thought).toBe("again");
	});

	it("turn updates the counter and the budget", () => {
		const state = apply([{ type: "turn", runId: RUN_ID, at: at(1), turn: 3, max_turns: 8 }]);
		expect(state.turn).toBe(3);
		expect(state.maxTurns).toBe(8);
	});

	it("message appends transcript entries and ignores an exact replay", () => {
		const entry = { turn: 1, role: "user" as const, text: "hi", at: at(4) };
		const bot = { turn: 1, role: "bot" as const, text: "hello", at: at(6), latency_ms: 1800 };
		const state = apply([
			{ type: "message", runId: RUN_ID, at: at(4), entry },
			{ type: "message", runId: RUN_ID, at: at(6), entry: bot },
			{ type: "message", runId: RUN_ID, at: at(4), entry },
		]);
		expect(state.transcript).toEqual([entry, bot]);
	});

	it("download collects artifacts keyed by path", () => {
		const artifact = { path: "downloads/a.pdf", filename: "a.pdf", bytes: 10, step: 3 };
		const state = apply([
			{ type: "download", runId: RUN_ID, at: at(5), artifact },
			{ type: "download", runId: RUN_ID, at: at(5), artifact: { ...artifact, bytes: 12 } },
		]);
		expect(state.downloads).toEqual([{ ...artifact, bytes: 12 }]);
	});

	it("judge_started lists the criteria that will be scored", () => {
		const state = apply([
			{ type: "judge_started", runId: RUN_ID, at: at(7), criteria: ["a", "b"] },
		]);
		expect(state.criteriaIds).toEqual(["a", "b"]);
		expect(state.criteria).toEqual([]);
	});

	it("criterion fills results by id, keeping the announced order", () => {
		const result = (id: string, score: number) => ({
			id,
			score,
			pass: score >= 0.5,
			weight: 1,
			required: false,
			reason: `${id} reason`,
			evidence: [],
		});
		const state = apply([
			{ type: "judge_started", runId: RUN_ID, at: at(7), criteria: ["a", "b"] },
			{ type: "criterion", runId: RUN_ID, at: at(8), result: result("b", 1) },
			{ type: "criterion", runId: RUN_ID, at: at(9), result: result("a", 0.2) },
			{ type: "criterion", runId: RUN_ID, at: at(9), result: result("a", 0.4) },
		]);
		expect(state.criteria.map((c) => [c.id, c.score])).toEqual([
			["a", 0.4],
			["b", 1],
		]);
	});

	it("done stores the verdict, its criteria, the report path and the final status", () => {
		const verdict: Verdict = { ...fx.verdict, runId: RUN_ID };
		const state = apply([
			{ type: "status", runId: RUN_ID, at: at(10), status: "JUDGING" },
			{ type: "done", runId: RUN_ID, at: at(12), verdict, report: "report.html" },
		]);
		expect(state.verdict).toEqual(verdict);
		expect(state.status).toBe(verdict.status);
		expect(state.report).toBe("report.html");
		expect(state.criteria).toEqual(verdict.criteria);
		expect(state.finishedAt).toBe(at(12));
	});

	it("a fatal error ends the run as ERROR; a non-fatal one is just listed", () => {
		const soft = apply([
			{ type: "error", runId: RUN_ID, at: at(3), message: "retrying", fatal: false },
		]);
		expect(soft.status).toBe("PENDING");
		expect(soft.errors).toEqual(["retrying"]);
		expect(soft.fatalError).toBeUndefined();
		const hard = applyRunEvent(soft, {
			type: "error",
			runId: RUN_ID,
			at: at(4),
			message: "browser crashed",
			fatal: true,
		});
		expect(hard.status).toBe("ERROR");
		expect(hard.fatalError).toBe("browser crashed");
		expect(hard.finishedAt).toBe(at(4));
	});

	it("log keeps the most recent entries only", () => {
		const events: RunEvent[] = Array.from({ length: 250 }, (_, i) => ({
			type: "log",
			runId: RUN_ID,
			at: at(i),
			level: "info",
			message: `line ${i}`,
		}));
		const state = apply(events);
		expect(state.logs).toHaveLength(200);
		expect(state.logs[0]?.message).toBe("line 50");
		expect(state.logs.at(-1)?.message).toBe("line 249");
	});

	it("never mutates the previous state", () => {
		const before = apply([step(1)]);
		const frozenSteps = before.steps;
		applyRunEvent(before, step(2));
		expect(before.steps).toBe(frozenSteps);
		expect(before.steps).toHaveLength(1);
	});
});

describe("fromDetail", () => {
	it("builds the state of a finished run from the stored record and verdict", () => {
		const detail = fx.runDetail(fx.PASSED_RUN_ID);
		if (!detail) throw new Error("fixture missing");
		const state = fromDetail(detail);
		expect(state.runId).toBe(fx.PASSED_RUN_ID);
		expect(state.status).toBe("PASSED");
		expect(state.verdict).toEqual(fx.verdict);
		expect(state.criteria).toEqual(fx.verdict.criteria);
		expect(state.report).toBe("report.html");
		expect(state.turn).toBe(detail.run.turns_used);
		expect(state.finishedAt).toBe(detail.run.finished_at);
	});

	it("carries the stored error of a run that ended in ERROR", () => {
		const detail = fx.runDetail(fx.FAILED_RUN_ID);
		if (!detail) throw new Error("fixture missing");
		const state = fromDetail({
			...detail,
			has_report: false,
			run: { ...detail.run, status: "ERROR", error: "judge model unavailable" },
		});
		expect(state.status).toBe("ERROR");
		expect(state.fatalError).toBe("judge model unavailable");
		expect(state.report).toBeUndefined();
	});
});

describe("isTerminalStatus", () => {
	it.each([
		["PENDING", false],
		["RUNNING", false],
		["JUDGING", false],
		["PASSED", true],
		["FAILED", true],
		["ERROR", true],
	] as const)("%s → %s", (status, expected) => {
		expect(isTerminalStatus(status)).toBe(expected);
	});
});
