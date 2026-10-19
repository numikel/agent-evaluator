import { describe, expect, it } from "vitest";
import { TINY_PNG } from "../../testing/fake-browser-session.js";
import { InMemoryStepRecorder } from "./recorder.js";

describe("InMemoryStepRecorder", () => {
	it("produces a valid Step with 1-based index, attachments and duration", async () => {
		const recorder = new InMemoryStepRecorder();
		const id = await recorder.begin({ kind: "click", ref: "e2" }, { turn: 1 });
		await recorder.attachBefore(id, TINY_PNG);
		await recorder.attachSnapshot(id, "- paragraph: hi");
		await recorder.attachInterim(id, TINY_PNG);
		await recorder.attachAfter(id, TINY_PNG);
		const step = await recorder.end(id, { result: "ok" });
		expect(step.index).toBe(1);
		expect(step.turn).toBe(1);
		expect(step.action).toEqual({ kind: "click", ref: "e2" });
		expect(step.screenshot_before).toBe("steps/001/before.png");
		expect(step.screenshot).toBe("steps/001/after.png");
		expect(step.interim_screenshots).toEqual(["steps/001/interim-1.png"]);
		expect(step.snapshot).toBe("steps/001/snapshot.txt");
		expect(step.result).toBe("ok");
		expect(step.duration_ms).toBeGreaterThanOrEqual(0);
		expect(step.started_at).toMatch(/T/);
		expect(recorder.steps).toEqual([step]);
		expect(recorder.files.get("steps/001/before.png")).toBe(TINY_PNG);
		expect(recorder.files.get("steps/001/snapshot.txt")).toBe("- paragraph: hi");
	});

	it("records errors and increments the index", async () => {
		const recorder = new InMemoryStepRecorder();
		await recorder.end(await recorder.begin({ kind: "snapshot" }), { result: "x" });
		const id = await recorder.begin({ kind: "download", ref: "e9" });
		const step = await recorder.end(id, { error: "boom" });
		expect(step.index).toBe(2);
		expect(step.error).toBe("boom");
		expect(step.result).toBeUndefined();
	});
});
