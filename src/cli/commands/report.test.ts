import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, type TempWorkspace } from "../../runner/testing.js";
import { createCliHarness, fakeRunnerFactory } from "../testing.js";

const SCENARIO = "invoice-export-september";

describe("report", () => {
	let ws: TempWorkspace;
	let runId: string;

	beforeEach(async () => {
		ws = await makeTempWorkspace();
		const cli = createCliHarness({ cwd: ws.root, createRunner: fakeRunnerFactory() });
		expect(await cli.run("run", SCENARIO, "--json")).toBe(0);
		runId = (JSON.parse(cli.stdout()) as Array<{ runId: string }>)[0]?.runId ?? "";
	});

	afterEach(async () => {
		await ws.cleanup();
	});

	it("re-renders report.html, summary.json and junit.xml from the stored artifacts", async () => {
		const reportPath = ws.runStore.artifactPath(runId, "report.html");
		const before = await readFile(ws.runStore.artifactPath(runId, "summary.json"), "utf8");
		await rm(reportPath);
		expect(existsSync(reportPath)).toBe(false);

		const opened: string[] = [];
		const cli = createCliHarness({
			cwd: ws.root,
			openUrl: async (url) => {
				opened.push(url);
			},
		});
		expect(await cli.run("report", runId, "--open")).toBe(0);

		expect(existsSync(reportPath)).toBe(true);
		const html = await readFile(reportPath, "utf8");
		expect(html).toContain(SCENARIO);
		expect(html).toContain("PASSED");
		expect(await readFile(ws.runStore.artifactPath(runId, "summary.json"), "utf8")).toBe(before);
		expect(cli.stdout()).toContain(reportPath);
		expect(opened).toEqual([`file://${reportPath}`]);
	});

	it("exits 1 for an unknown run id", async () => {
		const cli = createCliHarness({ cwd: ws.root });
		expect(await cli.run("report", "20260101-000000-nope-0000")).toBe(1);
		expect(cli.stderr()).toContain("20260101-000000-nope-0000");
	});

	it("exits 1 when the run has no verdict to render", async () => {
		await rm(ws.runStore.artifactPath(runId, "verdict.json"));
		const cli = createCliHarness({ cwd: ws.root });
		expect(await cli.run("report", runId)).toBe(1);
		expect(cli.stderr()).toContain("no verdict");
	});
});
