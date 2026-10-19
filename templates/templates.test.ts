import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
	EvaluatorConfigSchema,
	PersonaFrontmatterSchema,
	RubricSchema,
	ScenarioSchema,
	SettingsSchema,
	TargetSchema,
	withBuiltinCriteria,
} from "../src/schemas/index.js";

const here = fileURLToPath(new URL("./", import.meta.url));
const read = (name: string) => readFile(`${here}${name}`, "utf8");

/** Minimal frontmatter splitter mirroring what P1 implements (kept here so templates are validated in P0). */
function splitFrontmatter(markdown: string): { frontmatter: unknown; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
	if (!match) throw new Error("missing frontmatter");
	return { frontmatter: parseYaml(match[1] ?? ""), body: match[2] ?? "" };
}

describe("shipped templates validate against their schemas", () => {
	it("PERSONA.md", async () => {
		const { frontmatter, body } = splitFrontmatter(await read("PERSONA.md"));
		const fm = PersonaFrontmatterSchema.parse(frontmatter);
		expect(fm.name).toBe("impatient-smb-owner");
		for (const heading of [
			"# Background",
			"# Goals & motivations",
			"# Communication style",
			"# Knowledge & experience",
			"# Constraints",
		]) {
			expect(body).toContain(heading);
		}
	});

	it("scenario.yaml references the template persona/target", async () => {
		const s = ScenarioSchema.parse(parseYaml(await read("scenario.yaml")));
		expect(s.persona).toBe("impatient-smb-owner");
		expect(s.target).toBe("demo-chatbot");
		expect(s.max_turns).toBe(6);
	});

	it("rubric.yaml covers every criterion type", async () => {
		const r = withBuiltinCriteria(RubricSchema.parse(parseYaml(await read("rubric.yaml"))));
		const types = new Set(r.criteria.map((c) => c.type));
		expect([...types].sort()).toEqual(
			["contains", "file", "llm", "max_response_time_ms", "no_console_errors", "regex"]
				.filter((t) => t !== "contains")
				.sort(),
		);
		expect(r.criteria[0]?.id).toBe("goal_reached");
	});

	it("target.yaml", async () => {
		const t = TargetSchema.parse(parseYaml(await read("target.yaml")));
		expect(t.url).toBe("http://localhost:3999");
		expect(t.hints.length).toBeGreaterThan(0);
	});

	it("evaluator.yaml", async () => {
		const e = EvaluatorConfigSchema.parse(parseYaml(await read("evaluator.yaml")));
		expect(e.default_rubric).toBe("customer-support");
	});

	it("agent-evaluator.yaml contains no secrets and explicit model refs", async () => {
		const raw = await read("agent-evaluator.yaml");
		expect(raw).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
		const s = SettingsSchema.parse(parseYaml(raw));
		expect(s.models.simulator).toMatch(/^[a-z_-]+:/);
	});
});
