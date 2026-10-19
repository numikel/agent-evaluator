import type { RunSummary } from "@schemas/run";
import { describe, expect, it } from "vitest";
import {
	describeAction,
	formatBytes,
	formatDuration,
	formatLatency,
	passRateByScenario,
	recentRuns,
	runDurationMs,
} from "./stats.js";

const summary = (
	id: string,
	scenario: string,
	status: RunSummary["status"],
	started_at: string,
): RunSummary => ({
	id,
	scenario,
	persona: "p",
	target: "t",
	status,
	started_at,
	turns_used: 1,
	max_turns: 5,
	repeat_index: 1,
	repeat_total: 1,
});

describe("passRateByScenario", () => {
	it("counts PASSED over PASSED+FAILED per scenario, ignoring unfinished and errored runs", () => {
		const runs = [
			summary("1", "a", "PASSED", "2026-10-19T10:00:00Z"),
			summary("2", "a", "FAILED", "2026-10-19T11:00:00Z"),
			summary("3", "a", "PASSED", "2026-10-19T12:00:00Z"),
			summary("4", "a", "ERROR", "2026-10-19T13:00:00Z"),
			summary("5", "a", "RUNNING", "2026-10-19T14:00:00Z"),
			summary("6", "b", "FAILED", "2026-10-19T10:00:00Z"),
			summary("7", "c", "RUNNING", "2026-10-19T10:00:00Z"),
		];
		expect(passRateByScenario(runs)).toEqual([
			{ scenario: "a", total: 5, passed: 2, failed: 1, errored: 1, rate: 2 / 3 },
			{ scenario: "b", total: 1, passed: 0, failed: 1, errored: 0, rate: 0 },
			{ scenario: "c", total: 1, passed: 0, failed: 0, errored: 0, rate: undefined },
		]);
	});

	it("returns an empty list for no runs", () => {
		expect(passRateByScenario([])).toEqual([]);
	});
});

describe("recentRuns", () => {
	it("returns the newest runs first, capped at the limit", () => {
		const runs = Array.from({ length: 12 }, (_, i) =>
			summary(String(i), "a", "PASSED", `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`),
		);
		const recent = recentRuns(runs, 10);
		expect(recent).toHaveLength(10);
		expect(recent[0]?.id).toBe("11");
		expect(recent[9]?.id).toBe("2");
	});
});

describe("formatting", () => {
	it("formats durations between two timestamps", () => {
		expect(runDurationMs("2026-10-19T10:00:00Z", "2026-10-19T10:04:12Z")).toBe(252_000);
		expect(formatDuration(252_000)).toBe("4m 12s");
		expect(formatDuration(59_400)).toBe("59s");
		expect(formatDuration(3_725_000)).toBe("1h 2m");
		expect(formatDuration(undefined)).toBe("—");
	});

	it("formats bot latency in seconds with one decimal", () => {
		expect(formatLatency(4200)).toBe("4.2 s");
		expect(formatLatency(850)).toBe("0.9 s");
		expect(formatLatency(undefined)).toBe("");
	});

	it("formats byte sizes", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2048)).toBe("2.0 kB");
		expect(formatBytes(3_500_000)).toBe("3.3 MB");
	});

	it("describes actions for humans", () => {
		expect(describeAction({ kind: "open", url: "http://x" })).toBe("open http://x");
		expect(describeAction({ kind: "send_message", text: "need my invoice" })).toBe(
			'send "need my invoice"',
		);
		expect(describeAction({ kind: "click", ref: "e12" })).toBe("click e12");
		expect(describeAction({ kind: "snapshot" })).toBe("snapshot");
		expect(
			describeAction({ kind: "end_conversation", reason: "goal_reached", summary: "done" }),
		).toBe("end conversation (goal_reached)");
	});
});
