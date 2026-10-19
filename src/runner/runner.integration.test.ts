/**
 * Runs the whole graph against the demo chatbot through the real `PlaywrightSessionFactory`
 * with scripted models. Needs Chromium (`AE_CHROMIUM_PATH` or `npx playwright install chromium`);
 * set `AE_SKIP_BROWSER=1` to skip.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BaseMessage } from "@langchain/core/messages";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDemo } from "../../fixtures/demo-chatbot/server.js";
import { PlaywrightSessionFactory } from "../browser/index.js";
import type { RunEvent } from "../schemas/index.js";
import {
	ScriptedChatModel,
	type ScriptedTurn,
	type ToolCallScript,
} from "../testing/scripted-chat-model.js";
import { createRunner, type RunnerHandle } from "./index.js";
import {
	editResource,
	makeTempWorkspace,
	ScriptedModelFactory,
	type TempWorkspace,
} from "./testing.js";

const SCENARIO = "invoice-export-september";
const TEST_TIMEOUT_MS = 40_000;

type TurnSpec = { toolCalls: ToolCallScript[] };
const call = (name: string, args: Record<string, unknown> = {}): TurnSpec => ({
	toolCalls: [{ name, args }],
});

function lastToolText(messages: BaseMessage[]): string {
	const tool = messages.filter((m) => m.getType() === "tool").at(-1);
	return typeof tool?.content === "string" ? tool.content : JSON.stringify(tool?.content ?? "");
}

/** Picks the ref of the `button "Download"` from the latest snapshot the model received. */
const downloadFromSnapshot: ScriptedTurn = (messages) => {
	const match = /button "Download"[^\n]*\[ref=([a-z0-9]+)\]/.exec(lastToolText(messages));
	if (!match?.[1]) {
		return call("end_conversation", { reason: "gave_up", summary: "No Download button found." });
	}
	return call("download", { ref: match[1] });
};

const simulatorScript: ScriptedTurn[] = [
	call("snapshot"),
	call("send_message", { text: "need my invoice for september, customer 4471" }),
	call("snapshot"),
	downloadFromSnapshot,
	call("end_conversation", { reason: "goal_reached", summary: "Downloaded the September PDF." }),
];

const judgeStructured = [
	{ steps: [2, 4] },
	{ score: 1, pass: true, reason: "The September PDF was downloaded.", evidence: [{ step: 4 }] },
	{ score: 4, pass: true, reason: "Polite and brief.", evidence: [] },
	{ score: 1, pass: true, reason: "No invented data.", evidence: [] },
	{ score: 5, pass: true, reason: "Stayed on task.", evidence: [] },
];

describe.skipIf(process.env.AE_SKIP_BROWSER === "1")("runner × Playwright × demo chatbot", () => {
	let ws: TempWorkspace;
	let demo: Awaited<ReturnType<typeof startDemo>>;
	let runner: RunnerHandle;

	beforeAll(async () => {
		demo = await startDemo(0);
		ws = await makeTempWorkspace();
		await editResource(ws.workspace, "target", "demo-chatbot", (raw) =>
			raw
				.replace("url: http://localhost:3999", `url: ${demo.url}`)
				.replace("stable_ms: 1500", "stable_ms: 600")
				.replace("capture_interval_ms: 2000", "capture_interval_ms: 300"),
		);
		runner = createRunner({
			workspace: ws.workspace,
			runStore: ws.runStore,
			browserFactory: new PlaywrightSessionFactory(),
			modelFactory: new ScriptedModelFactory({
				simulator: () => new ScriptedChatModel({ script: simulatorScript, strict: true }),
				judge: () => new ScriptedChatModel({ script: [], structured: judgeStructured }),
			}),
		});
	}, TEST_TIMEOUT_MS);

	afterAll(async () => {
		await runner?.close();
		await demo?.close();
		await ws?.cleanup();
	}, TEST_TIMEOUT_MS);

	it(
		"produces a PASSED run with screenshots, the PDF download, verdict and report",
		async () => {
			const startedAt = Date.now();
			const { runIds } = await runner.start({ scenario: SCENARIO });
			const runId = runIds[0] as string;
			const events: RunEvent[] = [];
			runner.subscribe(runId, (e) => {
				events.push(e);
			});
			const record = await runner.wait(runId);
			const elapsedMs = Date.now() - startedAt;

			expect(record.error).toBeUndefined();
			expect(record.status).toBe("PASSED");
			expect(record.turns_used).toBe(1);
			expect(record.simulator_outcome?.reason).toBe("goal_reached");
			expect(elapsedMs).toBeLessThan(TEST_TIMEOUT_MS);

			const dir = ws.runStore.dir(runId);
			const verdict = await ws.runStore.readVerdict(runId);
			expect(verdict?.status).toBe("PASSED");
			expect(verdict?.criteria.find((c) => c.id === "pdf_delivered")).toMatchObject({ pass: true });
			expect(verdict?.criteria.find((c) => c.id === "mentions_month")).toMatchObject({
				pass: true,
			});
			expect(verdict?.evidence_screenshots).toEqual(["steps/002/after.png", "steps/004/after.png"]);

			expect(existsSync(join(dir, "steps/001/after.png"))).toBe(true);
			const png = await readFile(join(dir, "steps/001/after.png"));
			expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
			const sendStep = (await ws.runStore.readSteps(runId))[1];
			expect(sendStep?.action.kind).toBe("send_message");
			expect(sendStep?.interim_screenshots.length).toBeGreaterThan(0);
			expect(sendStep?.result).toMatch(/september/i);

			const pdfs = (await readdir(join(dir, "downloads"))).filter((f) => f.endsWith(".pdf"));
			expect(pdfs).toHaveLength(1);
			expect((await stat(join(dir, "downloads", pdfs[0] as string))).size).toBeGreaterThanOrEqual(
				500,
			);
			const downloads = await ws.runStore.readDownloads(runId);
			expect(downloads[0]?.text_excerpt).toMatch(/invoice/i);

			const transcript = await ws.runStore.readTranscript(runId);
			expect(transcript.map((e) => e.role)).toEqual(["user", "bot"]);
			expect(transcript[1]?.latency_ms).toBeGreaterThan(0);

			const report = await readFile(join(dir, "report.html"), "utf8");
			expect(report).toContain("PASSED");
			expect(report).toContain("%");
			expect(existsSync(join(dir, "summary.json"))).toBe(true);
			expect(existsSync(join(dir, "junit.xml"))).toBe(true);

			expect(events[0]?.type).toBe("run_started");
			expect(events.at(-1)?.type).toBe("done");
			expect(events.some((e) => e.type === "download")).toBe(true);
			expect(await runner.active()).toEqual([]);
		},
		TEST_TIMEOUT_MS,
	);
});
