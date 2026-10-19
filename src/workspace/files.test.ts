import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../schemas/index.js";
import { FsWorkspace } from "./files.js";
import { joinFrontmatter } from "./frontmatter.js";
import type { Workspace } from "./types.js";

let root: string;
let workspace: Workspace;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ae-workspace-"));
	workspace = new FsWorkspace(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false,
	);

describe("FsWorkspace.init", () => {
	it("creates the directory layout and copies templates for missing files", async () => {
		const created = await workspace.init();

		expect(created).toEqual(
			expect.arrayContaining([
				"personas/impatient-smb-owner.md",
				"scenarios/invoice-export-september.yaml",
				"rubrics/customer-support.yaml",
				"targets/demo-chatbot.yaml",
				"evaluator.yaml",
				"agent-evaluator.yaml",
			]),
		);
		for (const dir of ["personas", "scenarios", "rubrics", "targets", "runs"]) {
			expect(await exists(join(root, dir))).toBe(true);
		}
		expect(await readFile(join(root, "targets/demo-chatbot.yaml"), "utf8")).toContain(
			"http://localhost:3999",
		);
	});

	it("is idempotent: a second call creates nothing and keeps user edits", async () => {
		await workspace.init();
		await writeFile(join(root, "evaluator.yaml"), "principles: mine\n");

		const created = await workspace.init();

		expect(created).toEqual([]);
		expect(await readFile(join(root, "evaluator.yaml"), "utf8")).toBe("principles: mine\n");
	});

	it("overwrites existing files with { force: true }", async () => {
		await workspace.init();
		await writeFile(join(root, "evaluator.yaml"), "principles: mine\n");

		const created = await workspace.init({ force: true });

		expect(created).toContain("evaluator.yaml");
		expect(await readFile(join(root, "evaluator.yaml"), "utf8")).toContain("You are evaluating");
	});
});

describe("FsWorkspace.template", () => {
	it("returns the shipped template for every kind", async () => {
		expect(await workspace.template("persona")).toMatch(/^---\n/);
		expect(await workspace.template("scenario")).toContain("name: invoice-export-september");
		expect(await workspace.template("rubric")).toContain("name: customer-support");
		expect(await workspace.template("target")).toContain("name: demo-chatbot");
		expect(await workspace.template("evaluator")).toContain("principles:");
		expect(await workspace.template("settings")).toContain("models:");
	});
});

describe("FsWorkspace.load*", () => {
	beforeEach(() => workspace.init());

	it("loadScenario returns the parsed scenario with defaults applied", async () => {
		const scenario = await workspace.loadScenario("invoice-export-september");
		expect(scenario.persona).toBe("impatient-smb-owner");
		expect(scenario.max_turns).toBe(6);
		expect(scenario.repeat).toBe(1);
		expect(scenario.vision).toBe(false);
	});

	it("loadScenario throws a ValidationError naming the file for invalid content", async () => {
		const path = join(root, "scenarios/broken.yaml");
		const yaml = (await readFile(join(root, "scenarios/invoice-export-september.yaml"), "utf8"))
			.replace("name: invoice-export-september", "name: broken")
			.replace("max_turns: 6", "max_turns: 0");
		await writeFile(path, yaml);

		const error = await workspace.loadScenario("broken").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).message).toContain("scenarios/broken.yaml");
		expect((error as ValidationError).issues[0]?.path).toBe("max_turns");
	});

	it("loadPersona returns frontmatter, body and path", async () => {
		const persona = await workspace.loadPersona("impatient-smb-owner");
		expect(persona.frontmatter.name).toBe("impatient-smb-owner");
		expect(persona.frontmatter.traits).toContain("impatient");
		expect(persona.body).toContain("# Background");
		expect(persona.path).toBe("personas/impatient-smb-owner.md");
	});

	it("loadRubric, loadTarget, loadEvaluator and loadSettings parse their files", async () => {
		const rubric = await workspace.loadRubric("customer-support");
		expect(rubric.pass_threshold).toBe(0.7);
		expect(rubric.criteria.map((c) => c.id)).not.toContain("goal_reached");

		const target = await workspace.loadTarget("demo-chatbot");
		expect(target.url).toBe("http://localhost:3999");
		expect(target.timeouts.response_ms).toBe(60_000);

		const evaluator = await workspace.loadEvaluator();
		expect(evaluator.default_rubric).toBe("customer-support");

		const settings = await workspace.loadSettings();
		expect(settings.server.port).toBe(4747);
		expect(settings.runs_dir).toBe("runs");
	});

	it("loadSettings falls back to defaults when the settings file is absent", async () => {
		await rm(join(root, "agent-evaluator.yaml"));
		const settings = await workspace.loadSettings();
		expect(settings.concurrency).toBe(1);
		expect(settings.models.simulator).toMatch(/^[a-z_-]+:/);
	});

	it("throws a clear error for a missing resource", async () => {
		await expect(workspace.loadTarget("nope")).rejects.toThrow(
			/target 'nope'.*targets\/nope\.yaml/,
		);
	});
});

describe("FsWorkspace.list", () => {
	it("lists resources with name, description, path and updated_at", async () => {
		await workspace.init();
		const scenarios = await workspace.list("scenario");
		expect(scenarios).toHaveLength(1);
		expect(scenarios[0]).toMatchObject({
			name: "invoice-export-september",
			description: "Customer wants last month's invoice as a PDF.",
			path: "scenarios/invoice-export-september.yaml",
		});
		expect(scenarios[0]?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		const personas = await workspace.list("persona");
		expect(personas[0]).toMatchObject({
			name: "impatient-smb-owner",
			path: "personas/impatient-smb-owner.md",
		});
		expect(personas[0]?.description).toContain("Owner of a small business");
	});

	it("returns an empty list for a missing directory and ignores unparsable files", async () => {
		expect(await workspace.list("rubric")).toEqual([]);
		await workspace.init();
		await writeFile(join(root, "rubrics/garbage.yaml"), "::: not yaml\n  - [");
		const rubrics = await workspace.list("rubric");
		expect(rubrics.map((r) => r.name).sort()).toEqual(["customer-support", "garbage"]);
	});
});

describe("FsWorkspace.resolve", () => {
	beforeEach(() => workspace.init());

	it("wires persona, target, rubric (from default_rubric), evaluator and settings", async () => {
		const resolved = await workspace.resolve("invoice-export-september");

		expect(resolved.scenario.name).toBe("invoice-export-september");
		expect(resolved.persona.frontmatter.name).toBe("impatient-smb-owner");
		expect(resolved.target.name).toBe("demo-chatbot");
		expect(resolved.rubric.name).toBe("customer-support");
		expect(resolved.rubric.criteria[0]?.id).toBe("goal_reached");
		expect(resolved.evaluator.default_rubric).toBe("customer-support");
		expect(resolved.settings.runs_dir).toBe("runs");
	});

	it("prefers the scenario's own rubric over the default", async () => {
		await workspace.writeRaw(
			"rubric",
			["name: strict", "criteria:", "  - id: tone", "    type: llm", "    description: x"].join(
				"\n",
			),
			"strict",
		);
		const raw = await workspace.readRaw("scenario", "invoice-export-september");
		await workspace.writeRaw("scenario", `${raw}\nrubric: strict\n`, "invoice-export-september");

		const resolved = await workspace.resolve("invoice-export-september");
		expect(resolved.rubric.name).toBe("strict");
	});

	it("applies a target override", async () => {
		const raw = await workspace.readRaw("target", "demo-chatbot");
		await workspace.writeRaw(
			"target",
			raw
				.replace("name: demo-chatbot", "name: staging")
				.replace("localhost:3999", "localhost:4000"),
			"staging",
		);

		const resolved = await workspace.resolve("invoice-export-september", { target: "staging" });
		expect(resolved.target.name).toBe("staging");
		expect(resolved.target.url).toBe("http://localhost:4000");
	});

	it("reports a missing persona with the referencing scenario", async () => {
		await rm(join(root, "personas/impatient-smb-owner.md"));
		await expect(workspace.resolve("invoice-export-september")).rejects.toThrow(
			"persona 'impatient-smb-owner' referenced by scenario 'invoice-export-september' not found",
		);
	});

	it("reports a missing target with the referencing scenario", async () => {
		await expect(
			workspace.resolve("invoice-export-september", { target: "missing" }),
		).rejects.toThrow(
			"target 'missing' referenced by scenario 'invoice-export-september' not found",
		);
	});

	it("fails when neither the scenario nor evaluator.yaml names a rubric", async () => {
		const raw = await workspace.readRaw("evaluator");
		await workspace.writeRaw("evaluator", raw.replace("default_rubric: customer-support", ""));
		await expect(workspace.resolve("invoice-export-september")).rejects.toThrow(
			/no rubric.*invoice-export-september.*default_rubric/,
		);
	});
});

describe("FsWorkspace raw access", () => {
	beforeEach(() => workspace.init());

	it("readRaw returns the file content verbatim", async () => {
		const raw = await workspace.readRaw("evaluator");
		expect(raw).toBe(await readFile(join(root, "evaluator.yaml"), "utf8"));
		const persona = await workspace.readRaw("persona", "impatient-smb-owner");
		expect(persona.startsWith("---\n")).toBe(true);
	});

	it("writeRaw validates before writing and leaves the old file untouched on failure", async () => {
		const before = await readFile(join(root, "scenarios/invoice-export-september.yaml"), "utf8");

		await expect(
			workspace.writeRaw(
				"scenario",
				"name: invoice-export-september\n",
				"invoice-export-september",
			),
		).rejects.toBeInstanceOf(ValidationError);

		const after = await readFile(join(root, "scenarios/invoice-export-september.yaml"), "utf8");
		expect(after).toBe(before);
	});

	it("writeRaw creates new resources (and their directory) when valid", async () => {
		await rm(join(root, "personas"), { recursive: true });
		const content = joinFrontmatter(
			{ name: "calm-dev", description: "Calm developer" },
			"# Body\n",
		);
		await workspace.writeRaw("persona", content, "calm-dev");
		expect(await readFile(join(root, "personas/calm-dev.md"), "utf8")).toBe(content);
		expect((await workspace.loadPersona("calm-dev")).frontmatter.language).toBe("en");
	});

	it("writeRaw requires a name for named kinds", async () => {
		await expect(workspace.writeRaw("persona", "---\nname: x\n---\n")).rejects.toThrow(/name/);
	});

	it("validateRaw reports issues without writing", async () => {
		const bad = await workspace.validateRaw("target", "name: t\nurl: not-a-url\n");
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.issues.some((i) => i.path === "url")).toBe(true);

		const invalidYaml = await workspace.validateRaw("rubric", "name: [\n");
		expect(invalidYaml.ok).toBe(false);

		const noFrontmatter = await workspace.validateRaw("persona", "# no frontmatter\n");
		expect(noFrontmatter.ok).toBe(false);

		expect(await workspace.validateRaw("settings", "concurrency: 2\n")).toEqual({ ok: true });
		expect(await readdir(join(root, "targets"))).toEqual(["demo-chatbot.yaml"]);
	});

	it("remove deletes a resource and fails for unknown names", async () => {
		await workspace.remove("target", "demo-chatbot");
		expect(await exists(join(root, "targets/demo-chatbot.yaml"))).toBe(false);
		await expect(workspace.remove("target", "demo-chatbot")).rejects.toThrow(/demo-chatbot/);
	});

	it("rejects names that are not slugs (no path traversal through names)", async () => {
		await expect(workspace.readRaw("persona", "../evaluator")).rejects.toThrow(/slug/);
		await expect(workspace.loadScenario("../x")).rejects.toThrow(/slug/);
	});
});
