import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempWorkspace, type TempWorkspace } from "../../runner/testing.js";
import { createCliHarness } from "../testing.js";

describe("validate", () => {
	let ws: TempWorkspace;

	beforeEach(async () => {
		ws = await makeTempWorkspace();
	});

	afterEach(async () => {
		await ws.cleanup();
	});

	it("passes a freshly initialised workspace and lists every checked file", async () => {
		const cli = createCliHarness({ cwd: ws.root });
		expect(await cli.run("validate")).toBe(0);
		const stdout = cli.stdout();
		for (const file of [
			"personas/impatient-smb-owner.md",
			"scenarios/invoice-export-september.yaml",
			"rubrics/customer-support.yaml",
			"targets/demo-chatbot.yaml",
			"evaluator.yaml",
			"agent-evaluator.yaml",
		]) {
			expect(stdout).toContain(`✓ ${file}`);
		}
		expect(stdout).toMatch(/6 files checked, no issues/);
	});

	it("seam 2: exits 1 and lists `scenarios/bad.yaml: max_turns …` for an invalid file", async () => {
		const template = await readFile(
			join(ws.root, "scenarios", "invoice-export-september.yaml"),
			"utf8",
		);
		await writeFile(
			join(ws.root, "scenarios", "bad.yaml"),
			template
				.replace("name: invoice-export-september", "name: bad")
				.replace("max_turns: 6", "max_turns: 0"),
		);

		const cli = createCliHarness();
		expect(await cli.run("validate", "--workspace", ws.root)).toBe(1);
		expect(cli.stdout()).toContain("✗ scenarios/bad.yaml");
		expect(cli.stdout()).toMatch(/scenarios\/bad\.yaml: max_turns: /);
		expect(cli.stdout()).toContain("✓ scenarios/invoice-export-september.yaml");
		expect(cli.stderr()).toMatch(/1 issue/);
	});

	it("reports dangling cross-references through workspace.resolve", async () => {
		const template = await readFile(
			join(ws.root, "scenarios", "invoice-export-september.yaml"),
			"utf8",
		);
		await writeFile(
			join(ws.root, "scenarios", "dangling.yaml"),
			template
				.replace("name: invoice-export-september", "name: dangling")
				.replace("persona: impatient-smb-owner", "persona: ghost"),
		);

		const cli = createCliHarness({ cwd: ws.root });
		expect(await cli.run("validate")).toBe(1);
		expect(cli.stdout()).toMatch(/scenarios\/dangling\.yaml: .*persona 'ghost'/);
	});

	it("flags a scenario whose name does not match its file name", async () => {
		const template = await readFile(
			join(ws.root, "scenarios", "invoice-export-september.yaml"),
			"utf8",
		);
		await writeFile(join(ws.root, "scenarios", "renamed.yaml"), template);

		const cli = createCliHarness({ cwd: ws.root });
		expect(await cli.run("validate")).toBe(1);
		expect(cli.stdout()).toMatch(
			/scenarios\/renamed\.yaml: name: 'invoice-export-september' does not match/,
		);
	});

	it("tells the user to run init when evaluator.yaml is missing", async () => {
		const empty = await mkdtemp(join(tmpdir(), "ae-cli-empty-"));
		try {
			const cli = createCliHarness({ cwd: empty });
			expect(await cli.run("validate")).toBe(1);
			expect(cli.stdout()).toContain("evaluator.yaml");
			expect(cli.stdout()).toContain("agent-evaluator init");
		} finally {
			await rm(empty, { recursive: true, force: true });
		}
	});
});
