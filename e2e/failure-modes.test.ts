/**
 * The demo chatbot's failure modes end in a judged FAILED run, never in an ERROR: no attachment,
 * a reply stream that never completes (and logs a console error), and a chatty simulated user
 * that exhausts `max_turns`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	chattyScript,
	type E2eContext,
	judgeOutputs,
	runScenario,
	setupE2e,
	USER_MESSAGE,
} from "./helpers.js";

describe("failure modes of the demo chatbot", () => {
	let ctx: E2eContext | undefined;

	afterEach(async () => {
		await ctx?.cleanup();
		ctx = undefined;
	});

	it("?mode=noattach: no PDF → pdf_delivered fails → FAILED with a criteria breakdown", async () => {
		ctx = await setupE2e({ mode: "noattach", judge: judgeOutputs({ goalReached: false }) });
		const { runId, record, dir } = await runScenario(ctx);

		expect(record.error).toBeUndefined();
		expect(record.status).toBe("FAILED");
		expect(record.simulator_outcome?.reason).toBe("gave_up");

		const verdict = await ctx.ws.runStore.readVerdict(runId);
		expect(verdict?.status).toBe("FAILED");
		expect(verdict?.goal_reached).toBe(false);
		const pdf = verdict?.criteria.find((c) => c.id === "pdf_delivered");
		expect(pdf).toMatchObject({ pass: false, required: true });
		expect(pdf?.reason).toMatch(/pdf|download|file/i);
		expect(verdict?.criteria.find((c) => c.id === "mentions_month")).toMatchObject({
			pass: true,
		});
		expect(verdict?.criteria.find((c) => c.id === "clean_console")).toMatchObject({
			pass: true,
		});
		expect(verdict?.criteria.length).toBeGreaterThanOrEqual(8);
		expect(await ctx.ws.runStore.readDownloads(runId)).toEqual([]);

		const transcript = await ctx.ws.runStore.readTranscript(runId);
		expect(transcript.map((e) => e.role)).toEqual(["user", "bot"]);
		expect(transcript[1]?.text).toMatch(/billing/i);

		const report = await readFile(join(dir, "report.html"), "utf8");
		expect(report).toContain("FAILED");
		expect(report).toContain("pdf_delivered");
	});

	// The demo streams a third of the reply, emits an SSE `error` (→ console.error) and keeps the
	// request open forever. `waitForReplyStable` treats a request pending longer than `stable_ms`
	// as a long-lived stream, so the wait settles on the truncated reply well inside `response_ms`
	// instead of running out the clock; the console error and the missing PDF fail the run.
	it("?mode=broken: truncated reply, console error captured, run still judged FAILED", async () => {
		ctx = await setupE2e({
			mode: "broken",
			responseMs: 4_000,
			judge: judgeOutputs({ goalReached: false }),
		});
		const startedAt = Date.now();
		const { runId, record, dir } = await runScenario(ctx);
		const elapsedMs = Date.now() - startedAt;

		expect(record.error).toBeUndefined();
		expect(record.status).toBe("FAILED");
		expect(record.simulator_outcome?.reason).toBe("gave_up");
		expect(elapsedMs).toBeLessThan(30_000);

		const transcript = await ctx.ws.runStore.readTranscript(runId);
		expect(transcript.map((e) => e.role)).toEqual(["user", "bot"]);
		expect(transcript[1]?.text).toMatch(/here is your invoice/i);
		expect(transcript[1]?.text).not.toMatch(/download/i);

		const console = await ctx.ws.runStore.readConsole(runId);
		const streamErrors = console.filter(
			(e) => e.level === "error" && /stream error.*will not complete/i.test(e.text),
		);
		expect(streamErrors.length).toBeGreaterThan(0);
		expect(streamErrors.every((e) => typeof e.step === "number")).toBe(true);

		const verdict = await ctx.ws.runStore.readVerdict(runId);
		expect(verdict?.status).toBe("FAILED");
		const clean = verdict?.criteria.find((c) => c.id === "clean_console");
		expect(clean).toMatchObject({ pass: false });
		expect(clean?.reason).toMatch(/console error/i);
		expect(clean?.evidence.some((ref) => /will not complete/i.test(ref.quote ?? ""))).toBe(true);
		expect(verdict?.criteria.find((c) => c.id === "pdf_delivered")).toMatchObject({
			pass: false,
		});

		const steps = await ctx.ws.runStore.readSteps(runId);
		const sendStep = steps.find((s) => s.action.kind === "send_message");
		expect(sendStep?.error).toBeUndefined();
		expect(sendStep?.interim_screenshots.length).toBeGreaterThan(0);
		const report = await readFile(join(dir, "report.html"), "utf8");
		expect(report).toContain("FAILED");
		expect(report).toContain("clean_console");
	});

	it("max_turns: 1 with a chatty simulated user → FAILED with reason max_turns", async () => {
		ctx = await setupE2e({
			maxTurns: 1,
			simulator: chattyScript,
			strict: false,
			// The judge claims success; the runner's turn-budget safety net must override it.
			judge: judgeOutputs({ goalReached: true }),
		});
		const { runId, record } = await runScenario(ctx);

		expect(record.error).toBeUndefined();
		expect(record.status).toBe("FAILED");
		expect(record.turns_used).toBe(1);
		expect(record.max_turns).toBe(1);
		expect(record.simulator_outcome?.reason).toBe("max_turns");

		const verdict = await ctx.ws.runStore.readVerdict(runId);
		expect(verdict?.status).toBe("FAILED");
		expect(verdict?.goal_reached).toBe(false);
		expect(verdict?.criteria.find((c) => c.id === "goal_reached")).toMatchObject({
			pass: false,
			score: 0,
		});
		expect(verdict?.goal_assessment).toMatch(/turn budget/i);

		const transcript = await ctx.ws.runStore.readTranscript(runId);
		expect(transcript.filter((e) => e.role === "user").map((e) => e.text)).toEqual([USER_MESSAGE]);
	});
});
