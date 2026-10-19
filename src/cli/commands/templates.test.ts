import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCliHarness } from "../testing.js";

const FILES = [
	"PERSONA.md",
	"agent-evaluator.yaml",
	"evaluator.yaml",
	"rubric.yaml",
	"scenario.yaml",
	"target.yaml",
];

describe("templates", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "ae-cli-templates-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("seam 5: --out writes six files", async () => {
		const cli = createCliHarness();
		const out = join(dir, "exported");
		expect(await cli.run("templates", "--out", out)).toBe(0);
		expect((await readdir(out)).sort()).toEqual(FILES);
		expect(await readFile(join(out, "scenario.yaml"), "utf8")).toContain(
			"name: invoice-export-september",
		);
		for (const file of FILES) expect(cli.stdout()).toContain(file);
	});

	it("--kind prints one template to stdout", async () => {
		const cli = createCliHarness();
		expect(await cli.run("templates", "--kind", "scenario")).toBe(0);
		expect(cli.stdout()).toContain("name: invoice-export-september");
	});

	it("--kind with --out writes only that template", async () => {
		const cli = createCliHarness();
		expect(await cli.run("templates", "--kind", "persona", "--out", dir)).toBe(0);
		expect(await readdir(dir)).toEqual(["PERSONA.md"]);
	});

	it("without flags lists the available kinds", async () => {
		const cli = createCliHarness();
		expect(await cli.run("templates")).toBe(0);
		for (const kind of ["persona", "scenario", "rubric", "target", "evaluator", "settings"]) {
			expect(cli.stdout()).toContain(kind);
		}
	});

	it("rejects an unknown kind", async () => {
		const cli = createCliHarness();
		expect(await cli.run("templates", "--kind", "recipe")).toBe(1);
		expect(cli.stderr()).toContain("recipe");
	});
});
