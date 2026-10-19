/**
 * Happy path through the whole pipeline on a real Chromium: scripted simulator drives the demo
 * chatbot, downloads the September PDF, the scripted judge scores the run and the report renders.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunEvent } from "../src/index.js";
import { type E2eContext, runScenario, setupE2e } from "./helpers.js";

describe("pipeline: demo chatbot × scripted models × Chromium", () => {
	let ctx: E2eContext | undefined;

	afterEach(async () => {
		await ctx?.cleanup();
		ctx = undefined;
	});

	it("passes the invoice scenario with evidence, verdict and report", async () => {
		ctx = await setupE2e();
		const events: RunEvent[] = [];
		const { runIds } = await ctx.runner.start({ scenario: "invoice-export-september" });
		const runId = runIds[0] as string;
		ctx.runner.subscribe(runId, (event) => {
			events.push(event);
		});
		const record = await ctx.runner.wait(runId);
		const dir = ctx.ws.runStore.dir(runId);

		// Run record
		expect(record.error).toBeUndefined();
		expect(record.status).toBe("PASSED");
		expect(record.turns_used).toBe(1);
		expect(record.simulator_outcome?.reason).toBe("goal_reached");

		// Verdict
		const verdict = await ctx.ws.runStore.readVerdict(runId);
		expect(verdict?.status).toBe("PASSED");
		expect(verdict?.goal_reached).toBe(true);
		const pdf = verdict?.criteria.find((c) => c.id === "pdf_delivered");
		expect(pdf).toMatchObject({ pass: true, required: true });
		expect(verdict?.criteria.find((c) => c.id === "mentions_month")).toMatchObject({
			pass: true,
		});
		expect(verdict?.criteria.find((c) => c.id === "clean_console")).toMatchObject({
			pass: true,
		});

		// Downloaded PDF ≥ 500 bytes, extracted text persisted
		const pdfs = (await readdir(join(dir, "downloads"))).filter((f) => f.endsWith(".pdf"));
		expect(pdfs).toHaveLength(1);
		const size = (await stat(join(dir, "downloads", pdfs[0] as string))).size;
		expect(size).toBeGreaterThanOrEqual(500);
		const downloads = await ctx.ws.runStore.readDownloads(runId);
		expect(downloads[0]).toMatchObject({ mime: "application/pdf", bytes: size });
		expect(downloads[0]?.text_excerpt).toMatch(/invoice september 2026/i);

		// Screenshots for every step, interim screenshots for the streamed reply
		const steps = await ctx.ws.runStore.readSteps(runId);
		expect(steps.map((s) => s.action.kind)).toEqual([
			"snapshot",
			"send_message",
			"snapshot",
			"download",
			"end_conversation",
		]);
		for (const step of steps) {
			expect(step.screenshot, `step ${step.index} has a screenshot`).toBeTruthy();
			expect(existsSync(join(dir, step.screenshot as string))).toBe(true);
		}
		const png = await readFile(join(dir, steps[0]?.screenshot as string));
		expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
		const sendStep = steps[1];
		expect(sendStep?.interim_screenshots.length).toBeGreaterThan(0);
		for (const shot of sendStep?.interim_screenshots ?? []) {
			expect(existsSync(join(dir, shot))).toBe(true);
		}
		expect(sendStep?.result).toMatch(/september 2026/i);

		// Transcript: one user turn, one bot reply
		const transcript = await ctx.ws.runStore.readTranscript(runId);
		expect(transcript.map((e) => e.role)).toEqual(["user", "bot"]);
		expect(transcript[0]?.text).toBe("need my invoice for september, customer 4471");
		expect(transcript[1]?.text).toMatch(/september/i);
		expect(transcript[1]?.latency_ms).toBeGreaterThan(0);

		// Report + sidecars
		const report = await readFile(join(dir, "report.html"), "utf8");
		expect(report).toContain("PASSED");
		expect(report).toContain("%");
		expect(existsSync(join(dir, "verdict.json"))).toBe(true);
		expect(existsSync(join(dir, "summary.json"))).toBe(true);
		expect(existsSync(join(dir, "junit.xml"))).toBe(true);

		// Event stream
		expect(events[0]?.type).toBe("run_started");
		expect(events.some((e) => e.type === "download")).toBe(true);
		expect(events.at(-1)?.type).toBe("done");
		expect(await ctx.runner.active()).toEqual([]);
	});

	it("runs the scenario twice through one runner with fresh scripted models each time", async () => {
		ctx = await setupE2e();
		const first = await runScenario(ctx);
		const second = await runScenario(ctx);
		expect(first.record.status).toBe("PASSED");
		expect(second.record.status).toBe("PASSED");
		expect(first.runId).not.toBe(second.runId);
		expect(ctx.models.models("simulator")).toHaveLength(2);
		expect(ctx.models.models("judge")).toHaveLength(2);
	});
});
