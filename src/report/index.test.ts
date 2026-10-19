import { describe, expect, it } from "vitest";
import { failedMaxTurnsFixture } from "./fixtures/index.js";
import { renderReport } from "./index.js";

describe("renderReport", () => {
	it("produces the three files RunStore.saveReport expects", async () => {
		const files = await renderReport(failedMaxTurnsFixture());
		expect(Object.keys(files).sort()).toEqual(["junit.xml", "report.html", "summary.json"]);
		expect(files["report.html"]).toContain("<!doctype html>");
		expect(files["junit.xml"]).toContain("<testsuites");
		const summary = JSON.parse(files["summary.json"]);
		expect(summary).toMatchObject({ status: "FAILED", percent: 33, turns_used: 4, max_turns: 4 });
		expect(files["summary.json"].endsWith("\n")).toBe(true);
	});
});
