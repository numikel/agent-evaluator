import { describe, expect, it } from "vitest";
import { extractText, TEXT_CAP_BYTES } from "./extractors.js";
import { minimalPdf, PNG_1X1 } from "./test-fixtures.js";

describe("extractText (seam 2)", () => {
	it("extracts the embedded text of a generated PDF", async () => {
		const result = await extractText({
			path: "downloads/invoice.pdf",
			mime: "application/pdf",
			bytes: minimalPdf("Invoice INV-2026-09 September 2026"),
		});
		expect(result.error).toBeUndefined();
		expect(result.text).toContain("INV-2026-09");
		expect(result.text).toContain("September 2026");
		expect(result.mime).toBe("application/pdf");
	});

	it("infers the type from the extension when mime is missing", async () => {
		const result = await extractText({ path: "downloads/x.pdf", bytes: minimalPdf("Hello") });
		expect(result.mime).toBe("application/pdf");
		expect(result.text).toContain("Hello");
	});

	it("turns a CSV into its first 50 rows as text", async () => {
		const rows = ["id,amount", ...Array.from({ length: 80 }, (_, i) => `${i + 1},${i * 10}`)];
		const result = await extractText({
			path: "downloads/report.csv",
			mime: "text/csv",
			bytes: new TextEncoder().encode(rows.join("\n")),
		});
		expect(result.error).toBeUndefined();
		const lines = result.text.split("\n");
		expect(lines).toHaveLength(50);
		expect(lines[0]).toBe("id, amount");
		expect(lines[1]).toBe("1, 0");
	});

	it("returns text/* as-is", async () => {
		const result = await extractText({
			path: "downloads/notes.txt",
			mime: "text/plain",
			bytes: new TextEncoder().encode("plain text body"),
		});
		expect(result.text).toBe("plain text body");
	});

	it("returns empty text for images, keeping the mime", async () => {
		const result = await extractText({
			path: "downloads/a.png",
			mime: "image/png",
			bytes: PNG_1X1,
		});
		expect(result).toEqual({ text: "", mime: "image/png" });
	});

	it("never throws: a corrupt PDF yields empty text and an error", async () => {
		const result = await extractText({
			path: "downloads/bad.pdf",
			mime: "application/pdf",
			bytes: new TextEncoder().encode("%PDF-1.4 this is not really a pdf"),
		});
		expect(result.text).toBe("");
		expect(result.error).toMatch(/.+/);
	});

	it("never throws: a corrupt DOCX yields empty text and an error", async () => {
		const result = await extractText({
			path: "downloads/bad.docx",
			mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			bytes: new TextEncoder().encode("not a zip"),
		});
		expect(result.text).toBe("");
		expect(result.error).toMatch(/.+/);
	});

	it("returns empty text for unknown binary without throwing", async () => {
		const result = await extractText({
			path: "downloads/blob.bin",
			mime: "application/octet-stream",
			bytes: Uint8Array.from([0, 1, 2, 255]),
		});
		expect(result.text).toBe("");
		expect(result.mime).toBe("application/octet-stream");
	});

	it("caps extracted text at 20 kB", async () => {
		const result = await extractText({
			path: "downloads/big.txt",
			mime: "text/plain",
			bytes: new TextEncoder().encode("x".repeat(TEXT_CAP_BYTES * 2)),
		});
		expect(result.text.length).toBeLessThanOrEqual(TEXT_CAP_BYTES);
		expect(result.truncated).toBe(true);
	});
});
