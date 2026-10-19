import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunRecord, Step, TranscriptEntry } from "../schemas/index.js";
import { FsRunStore } from "./run-store.js";
import type { RunStore } from "./types.js";

let root: string;
let store: RunStore;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ae-runs-"));
	store = new FsRunStore(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function record(id: string, startedAt = "2026-10-19T10:00:00.000Z"): RunRecord {
	return {
		id,
		scenario: "invoice-export-september",
		persona: "impatient-smb-owner",
		target: "demo-chatbot",
		rubric: "customer-support",
		repeat_index: 1,
		repeat_total: 1,
		status: "PENDING",
		started_at: startedAt,
		turns_used: 0,
		max_turns: 6,
		models: { simulator: "anthropic:x", judge: "anthropic:x" },
	};
}

const step = (index: number): Step => ({
	index,
	turn: 1,
	action: { kind: "send_message", text: "hello" },
	interim_screenshots: [],
	screenshot: `steps/${String(index).padStart(3, "0")}/after.png`,
});

const entry = (turn: number, role: "user" | "bot"): TranscriptEntry => ({
	turn,
	role,
	text: `${role} says ${turn}`,
	at: "2026-10-19T10:00:01.000Z",
});

describe("FsRunStore records", () => {
	it("create writes run.json and returns the absolute run directory", async () => {
		const dir = await store.create(record("run-1"));
		expect(dir).toBe(join(root, "run-1"));
		expect(store.dir("run-1")).toBe(dir);
		const saved = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
		expect(saved.id).toBe("run-1");
		expect(await store.readRecord("run-1")).toEqual(record("run-1"));
		expect(await readdir(dir)).toEqual(["run.json"]);
	});

	it("updateRecord merges the patch, persists it and returns the new record", async () => {
		await store.create(record("run-1"));
		const updated = await store.updateRecord("run-1", { status: "RUNNING", turns_used: 2 });
		expect(updated.status).toBe("RUNNING");
		expect(updated.turns_used).toBe(2);
		expect(updated.scenario).toBe("invoice-export-september");
		expect(await store.readRecord("run-1")).toEqual(updated);
		expect(await readdir(store.dir("run-1"))).toEqual(["run.json"]);
	});

	it("updateRecord rejects a patch that breaks the schema", async () => {
		await store.create(record("run-1"));
		await expect(
			store.updateRecord("run-1", { status: "WEIRD" as RunRecord["status"] }),
		).rejects.toThrow(/run-1/);
		expect((await store.readRecord("run-1")).status).toBe("PENDING");
	});

	it("list returns summaries sorted by started_at descending and skips foreign dirs", async () => {
		await store.create(record("older", "2026-10-18T09:00:00.000Z"));
		await store.create(record("newest", "2026-10-19T12:00:00.000Z"));
		await store.create(record("middle", "2026-10-19T08:00:00.000Z"));
		await writeFile(join(root, "stray.txt"), "ignore me");
		await rm(join(root, "newest"), { recursive: true });
		await store.create(record("newest", "2026-10-19T12:00:00.000Z"));

		const list = await store.list();
		expect(list.map((r) => r.id)).toEqual(["newest", "middle", "older"]);
		expect(list[0]).toEqual({
			id: "newest",
			scenario: "invoice-export-september",
			persona: "impatient-smb-owner",
			target: "demo-chatbot",
			status: "PENDING",
			started_at: "2026-10-19T12:00:00.000Z",
			turns_used: 0,
			max_turns: 6,
			repeat_index: 1,
			repeat_total: 1,
		});
	});

	it("rejects run ids that could escape the runs directory", async () => {
		expect(() => store.dir("../x")).toThrow(/run id/);
		expect(() => store.dir("a/b")).toThrow(/run id/);
		await expect(store.create(record("../x"))).rejects.toThrow(/run id/);
	});
});

describe("FsRunStore evidence", () => {
	beforeEach(() => store.create(record("run-1")));

	it("saveScreenshot writes the PNG under steps/NNN and returns the relative path", async () => {
		const path = await store.saveScreenshot("run-1", 3, "after", PNG);
		expect(path).toBe("steps/003/after.png");
		expect(new Uint8Array(await readFile(join(store.dir("run-1"), "steps/003/after.png")))).toEqual(
			PNG,
		);
		expect(await store.saveScreenshot("run-1", 12, "interim-1.png", PNG)).toBe(
			"steps/012/interim-1.png",
		);
		expect(await store.readFile("run-1", path)).toEqual(PNG);
	});

	it("saveSnapshot and saveStep persist per-step files that readSteps returns in order", async () => {
		expect(await store.saveSnapshot("run-1", 2, "- button [ref=e1]")).toBe(
			"steps/002/snapshot.txt",
		);
		await store.saveStep("run-1", step(2));
		await store.saveStep("run-1", step(10));
		await store.saveStep("run-1", step(1));

		const steps = await store.readSteps("run-1");
		expect(steps.map((s) => s.index)).toEqual([1, 2, 10]);
		expect(steps[1]).toEqual(step(2));
		expect(await readFile(join(store.dir("run-1"), "steps/002/action.json"), "utf8")).toContain(
			'"kind": "send_message"',
		);
	});

	it("appendTranscript / readTranscript round-trip as JSONL", async () => {
		await store.appendTranscript("run-1", entry(1, "user"));
		await store.appendTranscript("run-1", entry(1, "bot"));
		expect(await store.readTranscript("run-1")).toEqual([entry(1, "user"), entry(1, "bot")]);
		const raw = await readFile(join(store.dir("run-1"), "transcript.jsonl"), "utf8");
		expect(raw.trimEnd().split("\n")).toHaveLength(2);
	});

	it("appendConsole and appendEvent append lines; readers return [] before any write", async () => {
		expect(await store.readConsole("run-1")).toEqual([]);
		await store.appendConsole("run-1", [
			{ level: "error", text: "boom", at: "2026-10-19T10:00:02.000Z" },
			{ level: "log", text: "ok", at: "2026-10-19T10:00:03.000Z", step: 1 },
		]);
		await store.appendConsole("run-1", []);
		expect((await store.readConsole("run-1")).map((c) => c.text)).toEqual(["boom", "ok"]);

		await store.appendEvent("run-1", {
			type: "status",
			runId: "run-1",
			status: "RUNNING",
			at: "2026-10-19T10:00:04.000Z",
		});
		const events = (await readFile(join(store.dir("run-1"), "events.jsonl"), "utf8"))
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(events).toEqual([expect.objectContaining({ type: "status", status: "RUNNING" })]);
	});

	it("saveDownload moves the file into downloads/ and records bytes and mime", async () => {
		const source = join(root, "incoming.pdf");
		await writeFile(source, "%PDF-1.4 fake");

		const artifact = await store.saveDownload("run-1", source, {
			filename: "invoice-09.pdf",
			mime: "application/pdf",
			bytes: 0,
			turn: 2,
		});

		expect(artifact).toEqual({
			path: "downloads/invoice-09.pdf",
			filename: "invoice-09.pdf",
			mime: "application/pdf",
			bytes: 13,
			turn: 2,
		});
		await expect(stat(source)).rejects.toThrow();
		expect(await readFile(join(store.dir("run-1"), "downloads/invoice-09.pdf"), "utf8")).toBe(
			"%PDF-1.4 fake",
		);
		expect(await store.readDownloads("run-1")).toEqual([artifact]);
	});

	it("saveDownload keeps both files when a filename repeats", async () => {
		for (const i of [1, 2]) {
			const source = join(root, `incoming-${i}.pdf`);
			await writeFile(source, `file ${i}`);
			await store.saveDownload("run-1", source, { filename: "report.pdf", bytes: 0 });
		}
		const downloads = await store.readDownloads("run-1");
		expect(downloads.map((d) => d.path)).toEqual([
			"downloads/report.pdf",
			"downloads/report-2.pdf",
		]);
		expect(await store.readFile("run-1", "downloads/report-2.pdf")).toEqual(
			new TextEncoder().encode("file 2"),
		);
	});

	it("saveVerdict / readVerdict and saveReport write the final artifacts", async () => {
		expect(await store.readVerdict("run-1")).toBeUndefined();
		const verdict = {
			runId: "run-1",
			status: "PASSED" as const,
			goal_reached: true,
			score: 0.9,
			pass_threshold: 0.7,
			turns_used: 3,
			max_turns: 6,
			criteria: [],
			summary: "fine",
			judged_at: "2026-10-19T10:05:00.000Z",
			judge_model: "anthropic:x",
			evidence_screenshots: [],
		};
		await store.saveVerdict("run-1", verdict);
		expect(await store.readVerdict("run-1")).toEqual(verdict);

		await store.saveReport("run-1", {
			"report.html": "<html></html>",
			"summary.json": "{}",
			"junit.xml": "<testsuite/>",
		});
		expect(await readFile(join(store.dir("run-1"), "report.html"), "utf8")).toBe("<html></html>");
		expect(await readFile(join(store.dir("run-1"), "junit.xml"), "utf8")).toBe("<testsuite/>");
	});

	it("artifactPath resolves inside the run dir and rejects traversal or absolute paths", () => {
		expect(store.artifactPath("run-1", "steps/001/after.png")).toBe(
			join(store.dir("run-1"), "steps", "001", "after.png"),
		);
		expect(() => store.artifactPath("run-1", "../x")).toThrow(/outside|traversal|relative/i);
		expect(() => store.artifactPath("run-1", "steps/../../run.json")).toThrow(/outside|traversal/i);
		expect(() => store.artifactPath("run-1", "/etc/passwd")).toThrow(/absolute/i);
		expect(() => store.artifactPath("../other", "run.json")).toThrow(/run id/);
	});

	it("readFile refuses traversal and reports missing artifacts", async () => {
		await expect(store.readFile("run-1", "../run.json")).rejects.toThrow();
		await expect(store.readFile("run-1", "steps/999/after.png")).rejects.toThrow();
	});
});
