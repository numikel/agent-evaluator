/**
 * Hand-rolled minimal PDF writer: one A4 page, Helvetica, one text line per entry. No
 * dependencies. The output is a well-formed PDF 1.4 file (catalog, pages, page, font, content
 * stream, xref table, trailer) that any viewer opens and whose text any extractor finds.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_LEFT = 72;
const TOP = PAGE_HEIGHT - 72;
const TITLE_SIZE = 18;
const BODY_SIZE = 12;
const LINE_HEIGHT = 18;

/** Escape a string for a PDF literal `( … )` and squash anything outside Latin-1. */
function pdfString(text: string): string {
	let out = "";
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 63;
		if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
		else if (code < 32 || code > 255) out += "?";
		else out += ch;
	}
	return out;
}

function contentStream(lines: readonly string[]): string {
	const [title = "", ...rest] = lines;
	const ops = [
		"BT",
		`/F1 ${TITLE_SIZE} Tf`,
		`${MARGIN_LEFT} ${TOP} Td`,
		`(${pdfString(title)}) Tj`,
	];
	if (rest.length > 0) {
		ops.push(`/F1 ${BODY_SIZE} Tf`, `${LINE_HEIGHT} TL`, `0 -${LINE_HEIGHT * 2} Td`);
		rest.forEach((line, index) => {
			if (index > 0) ops.push("T*");
			ops.push(`(${pdfString(line)}) Tj`);
		});
	}
	ops.push("ET");
	return ops.join("\n");
}

/** Build a single-page PDF; the first line is the title, the rest are body lines. */
export function buildPdf(lines: readonly string[]): Uint8Array<ArrayBuffer> {
	const content = contentStream(lines);
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
			"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
		`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
	];

	let body = "%PDF-1.4\n%âãÏÓ\n";
	const offsets: number[] = [];
	objects.forEach((object, index) => {
		offsets.push(Buffer.byteLength(body, "latin1"));
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});

	const xrefOffset = Buffer.byteLength(body, "latin1");
	const xref = [
		"xref",
		`0 ${objects.length + 1}`,
		"0000000000 65535 f ",
		...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
	].join("\n");
	body += `${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

	return new Uint8Array(Buffer.from(body, "latin1"));
}
