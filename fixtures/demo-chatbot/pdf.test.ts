import { describe, expect, it } from "vitest";
import { buildPdf } from "./pdf.js";

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("buildPdf()", () => {
	it("produces a syntactically valid single-page PDF containing the given lines", () => {
		const bytes = buildPdf(["Invoice September 2026", "Customer 4471", "Total: 120.00 EUR"]);
		const text = latin1(bytes);
		expect(text.startsWith("%PDF-1.4\n")).toBe(true);
		expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
		expect(text).toContain("/Type /Catalog");
		expect(text).toContain("/Type /Page");
		expect(text).toContain("(Invoice September 2026) Tj");
		expect(text).toContain("(Customer 4471) Tj");
	});

	it("writes an xref table whose offsets point at each object", () => {
		const bytes = buildPdf(["Invoice September 2026"]);
		const text = latin1(bytes);
		const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
		expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
		const table = text.slice(xrefAt);
		const entries = [...table.matchAll(/^(\d{10}) (\d{5}) n ?$/gm)].map((m) => Number(m[1]));
		expect(entries.length).toBeGreaterThanOrEqual(5);
		entries.forEach((offset, index) => {
			expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
		});
		const sizeMatch = /\/Size (\d+)/.exec(table);
		expect(Number(sizeMatch?.[1])).toBe(entries.length + 1);
	});

	it("escapes PDF string delimiters", () => {
		const text = latin1(buildPdf(["Acme (Ltd) \\ co"]));
		expect(text).toContain("(Acme \\(Ltd\\) \\\\ co) Tj");
	});

	it("declares the correct content stream length", () => {
		const text = latin1(buildPdf(["Invoice September 2026", "line two"]));
		const match = /\/Length (\d+)\s*>>\s*stream\n([\s\S]*?)\nendstream/.exec(text);
		expect(match).not.toBeNull();
		expect(match?.[2]?.length).toBe(Number(match?.[1]));
	});
});
