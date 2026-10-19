/**
 * Turns downloaded files into text the judge (and deterministic criteria) can read.
 * Never throws: failures come back as `{ text: "", error }` so a corrupt attachment cannot abort
 * the verdict. Output is capped at {@link TEXT_CAP_BYTES} characters.
 */
import { parse as parseCsv } from "csv-parse/sync";
import mammoth from "mammoth";
import { getDocumentProxy, extractText as pdfExtractText } from "unpdf";

/** Maximum characters of extracted text kept per file (20 kB). */
export const TEXT_CAP_BYTES = 20 * 1024;
/** Rows of a CSV rendered to text. */
export const CSV_MAX_ROWS = 50;

export type ExtractInput = {
	/** Run-relative path; used to infer the type when `mime` is missing. */
	path: string;
	mime?: string | undefined;
	bytes: Uint8Array;
};

export type ExtractResult = {
	text: string;
	/** Effective MIME type (given or inferred from the extension). */
	mime?: string;
	error?: string;
	/** Set when the text was cut at {@link TEXT_CAP_BYTES}. */
	truncated?: boolean;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MIME_BY_EXTENSION: Record<string, string> = {
	pdf: "application/pdf",
	docx: DOCX_MIME,
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	txt: "text/plain",
	md: "text/markdown",
	html: "text/html",
	htm: "text/html",
	json: "application/json",
	xml: "application/xml",
	yaml: "application/yaml",
	yml: "application/yaml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
};

/** Resolves the effective MIME type: the given one, else inferred from the file extension. */
export function resolveMime(path: string, mime?: string | undefined): string | undefined {
	const given = mime?.split(";")[0]?.trim().toLowerCase();
	if (given && given !== "application/octet-stream") return given;
	const ext = path.toLowerCase().split(".").pop() ?? "";
	return MIME_BY_EXTENSION[ext] ?? given;
}

type Kind = "pdf" | "docx" | "csv" | "text" | "image" | "unknown";

function kindOf(mime: string | undefined): Kind {
	if (!mime) return "unknown";
	if (mime === "application/pdf") return "pdf";
	if (mime === DOCX_MIME) return "docx";
	if (mime === "text/csv" || mime === "text/tab-separated-values") return "csv";
	if (mime.startsWith("image/")) return "image";
	if (
		mime.startsWith("text/") ||
		mime === "application/json" ||
		mime === "application/xml" ||
		mime === "application/yaml" ||
		mime.endsWith("+json") ||
		mime.endsWith("+xml")
	) {
		return "text";
	}
	return "unknown";
}

function cap(text: string): Pick<ExtractResult, "text" | "truncated"> {
	const trimmed = text.trim();
	if (trimmed.length <= TEXT_CAP_BYTES) return { text: trimmed };
	return { text: trimmed.slice(0, TEXT_CAP_BYTES), truncated: true };
}

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);

async function extractPdf(bytes: Uint8Array): Promise<string> {
	// unpdf mutates/transfers the buffer it receives; hand it a copy so callers keep their bytes.
	const proxy = await getDocumentProxy(new Uint8Array(bytes));
	const { text } = await pdfExtractText(proxy, { mergePages: true });
	return text;
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
	const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
	return value;
}

function extractCsv(bytes: Uint8Array, mime: string | undefined): string {
	const rows = parseCsv(decodeUtf8(bytes), {
		to: CSV_MAX_ROWS,
		relax_column_count: true,
		relax_quotes: true,
		skip_empty_lines: true,
		trim: true,
		delimiter: mime === "text/tab-separated-values" ? "\t" : ",",
	}) as string[][];
	return rows.map((row) => row.join(", ")).join("\n");
}

/** Extracts readable text from a downloaded file. Never throws. */
export async function extractText(input: ExtractInput): Promise<ExtractResult> {
	const mime = resolveMime(input.path, input.mime);
	const withMime = (r: ExtractResult): ExtractResult => (mime ? { ...r, mime } : r);
	try {
		switch (kindOf(mime)) {
			case "pdf":
				return withMime(cap(await extractPdf(input.bytes)));
			case "docx":
				return withMime(cap(await extractDocx(input.bytes)));
			case "csv":
				return withMime(cap(extractCsv(input.bytes, mime)));
			case "text":
				return withMime(cap(decodeUtf8(input.bytes)));
			case "image":
			case "unknown":
				return withMime({ text: "" });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return withMime({ text: "", error: `extraction failed: ${message}` });
	}
}
