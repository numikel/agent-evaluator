import { describe, expect, it } from "vitest";
import { parseYamlDocument, toYamlText } from "./yaml.js";

describe("yaml codec", () => {
	it("parses a YAML mapping into a record", () => {
		const result = parseYamlDocument("name: demo\nmax_turns: 6\ntags: [a, b]\n");
		expect(result).toEqual({ ok: true, value: { name: "demo", max_turns: 6, tags: ["a", "b"] } });
	});

	it("treats an empty document as an empty record", () => {
		expect(parseYamlDocument("")).toEqual({ ok: true, value: {} });
		expect(parseYamlDocument("# only a comment\n")).toEqual({ ok: true, value: {} });
	});

	it("rejects documents that are not mappings", () => {
		const result = parseYamlDocument("- just\n- a list\n");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error).toMatch(/mapping/i);
	});

	it("reports syntax errors with the parser message", () => {
		const result = parseYamlDocument("name: [unclosed\n");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.error.length).toBeGreaterThan(0);
	});

	it("round-trips a record through toYamlText", () => {
		const value = { name: "demo", nested: { a: 1 }, list: ["x"] };
		const text = toYamlText(value);
		expect(text.endsWith("\n")).toBe(true);
		expect(parseYamlDocument(text)).toEqual({ ok: true, value });
	});

	it("drops undefined keys when stringifying", () => {
		expect(toYamlText({ name: "demo", rubric: undefined })).toBe("name: demo\n");
	});
});
