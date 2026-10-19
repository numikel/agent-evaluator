import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCliHarness } from "../testing.js";

describe("init", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "ae-cli-init-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("seam 1: creates the workspace layout and prints the created files", async () => {
		const cli = createCliHarness();
		expect(await cli.run("init", dir)).toBe(0);

		for (const relative of ["personas", "scenarios", "rubrics", "targets", "runs"]) {
			expect(existsSync(join(dir, relative))).toBe(true);
		}
		const stdout = cli.stdout();
		expect(stdout).toContain(dir);
		for (const file of [
			"personas/impatient-smb-owner.md",
			"scenarios/invoice-export-september.yaml",
			"rubrics/customer-support.yaml",
			"targets/demo-chatbot.yaml",
			"evaluator.yaml",
			"agent-evaluator.yaml",
		]) {
			expect(stdout).toContain(file);
		}
	});

	it("seam 1: a second call is a no-op unless --force is given", async () => {
		const cli = createCliHarness();
		await cli.run("init", dir);
		const scenario = join(dir, "scenarios", "invoice-export-september.yaml");
		await writeFile(scenario, "# edited by hand\n");

		cli.reset();
		expect(await cli.run("init", dir)).toBe(0);
		expect(cli.stdout()).toContain("already initialised");
		expect(cli.stdout()).not.toContain("created ");
		expect(await readFile(scenario, "utf8")).toBe("# edited by hand\n");

		cli.reset();
		expect(await cli.run("init", dir, "--force")).toBe(0);
		expect(cli.stdout()).toContain("scenarios/invoice-export-september.yaml");
		expect(await readFile(scenario, "utf8")).toContain("name: invoice-export-september");
	});

	it("defaults to the current directory", async () => {
		const cli = createCliHarness({ cwd: dir });
		expect(await cli.run("init")).toBe(0);
		expect(existsSync(join(dir, "evaluator.yaml"))).toBe(true);
	});
});
