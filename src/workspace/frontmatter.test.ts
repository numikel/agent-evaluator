import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { joinFrontmatter, splitFrontmatter } from "./frontmatter.js";

const templatePath = fileURLToPath(new URL("../../templates/PERSONA.md", import.meta.url));

describe("splitFrontmatter", () => {
	it("round-trips the PERSONA template", async () => {
		const markdown = await readFile(templatePath, "utf8");
		const { frontmatter, body } = splitFrontmatter(markdown);
		expect(frontmatter).toMatchObject({ name: "impatient-smb-owner", language: "en" });
		expect(body.trimStart()).toMatch(/^# Background/);

		const rejoined = joinFrontmatter(frontmatter, body);
		expect(splitFrontmatter(rejoined)).toEqual({ frontmatter, body });
	});

	it("rejects a file without frontmatter, naming the file", () => {
		expect(() => splitFrontmatter("# Just a heading\n", "personas/x.md")).toThrow(
			/personas\/x\.md/,
		);
		expect(() => splitFrontmatter("# Just a heading\n")).toThrow(/frontmatter/);
	});

	it("accepts CRLF line endings and an empty body", () => {
		const { frontmatter, body } = splitFrontmatter("---\r\nname: a\r\n---\r\n");
		expect(frontmatter).toEqual({ name: "a" });
		expect(body).toBe("");
	});

	it("reports invalid YAML inside the frontmatter", () => {
		expect(() => splitFrontmatter("---\nname: [unclosed\n---\nbody", "p.md")).toThrow(/p\.md/);
	});
});

describe("joinFrontmatter", () => {
	it("produces a document that starts with a YAML block", () => {
		const doc = joinFrontmatter({ name: "x", traits: ["a", "b"] }, "# Body\n");
		expect(doc.startsWith("---\n")).toBe(true);
		expect(doc).toContain("name: x");
		expect(doc.endsWith("---\n\n# Body\n")).toBe(true);
	});
});
