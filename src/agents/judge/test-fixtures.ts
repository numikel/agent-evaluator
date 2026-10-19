/**
 * Test-only builders for the judge: the shipped template scenario resolved in memory, a run with a
 * short transcript, and a hand-rolled single-page PDF so extraction is proven without binary fixtures.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
	type ConsoleEntry,
	type DownloadArtifact,
	EvaluatorConfigSchema,
	PersonaFrontmatterSchema,
	RubricSchema,
	type RunRecord,
	ScenarioSchema,
	SettingsSchema,
	type Step,
	TargetSchema,
	type TranscriptEntry,
	withBuiltinCriteria,
} from "../../schemas/index.js";
import type { ResolvedScenario } from "../../workspace/types.js";
import type { JudgeInput } from "./types.js";

const templatesDir = fileURLToPath(new URL("../../../templates/", import.meta.url));
const readTemplate = (name: string) => readFile(`${templatesDir}${name}`, "utf8");

function splitFrontmatter(markdown: string): { frontmatter: unknown; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
	if (!match) throw new Error("missing frontmatter");
	return { frontmatter: parseYaml(match[1] ?? ""), body: match[2] ?? "" };
}

/** The shipped templates (`templates/*`) resolved the way `Workspace.resolve` would. */
export async function templateResolved(
	overrides: Partial<ResolvedScenario> = {},
): Promise<ResolvedScenario> {
	const personaMd = splitFrontmatter(await readTemplate("PERSONA.md"));
	return {
		scenario: ScenarioSchema.parse(parseYaml(await readTemplate("scenario.yaml"))),
		persona: {
			frontmatter: PersonaFrontmatterSchema.parse(personaMd.frontmatter),
			body: personaMd.body,
		},
		target: TargetSchema.parse(parseYaml(await readTemplate("target.yaml"))),
		rubric: withBuiltinCriteria(RubricSchema.parse(parseYaml(await readTemplate("rubric.yaml")))),
		evaluator: EvaluatorConfigSchema.parse(parseYaml(await readTemplate("evaluator.yaml"))),
		settings: SettingsSchema.parse(parseYaml(await readTemplate("agent-evaluator.yaml"))),
		...overrides,
	};
}

export const T0 = "2026-10-19T10:00:00.000Z";

export function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
	return {
		id: "run-20261019-100000-invoice",
		scenario: "invoice-export-september",
		persona: "impatient-smb-owner",
		target: "demo-chatbot",
		rubric: "customer-support",
		repeat_index: 1,
		repeat_total: 1,
		status: "JUDGING",
		started_at: T0,
		turns_used: 3,
		max_turns: 6,
		models: { simulator: "test:simulator", judge: "test:judge" },
		simulator_outcome: { reason: "goal_reached", summary: "Downloaded the September invoice PDF." },
		...overrides,
	};
}

/** Three turns: open page, then three send_message steps each followed by a download/read step. */
export function makeSteps(): Step[] {
	const step = (index: number, turn: number, action: Step["action"]): Step => ({
		index,
		turn,
		action,
		screenshot: `steps/${String(index).padStart(3, "0")}/after.png`,
		interim_screenshots: [],
	});
	return [
		step(1, 0, { kind: "open", url: "http://localhost:3999" }),
		step(2, 1, { kind: "send_message", text: "need my invoice for september as pdf" }),
		step(3, 2, { kind: "send_message", text: "customer 4471" }),
		step(4, 2, { kind: "download", ref: "e12" }),
		step(5, 3, { kind: "send_message", text: "is that the september one?" }),
		{
			index: 6,
			turn: 3,
			action: {
				kind: "end_conversation",
				reason: "goal_reached",
				summary: "Downloaded the September invoice PDF.",
			},
			interim_screenshots: [],
		},
	];
}

export function makeTranscript(): TranscriptEntry[] {
	return [
		{ turn: 1, role: "user", text: "need my invoice for september as pdf", at: T0, step: 2 },
		{
			turn: 1,
			role: "bot",
			text: "Sure. What is your customer number?",
			at: T0,
			latency_ms: 1200,
			step: 2,
		},
		{ turn: 2, role: "user", text: "customer 4471", at: T0, step: 3 },
		{
			turn: 2,
			role: "bot",
			text: "Here is your September invoice. Click Download to save the PDF.",
			at: T0,
			latency_ms: 2600,
			step: 3,
		},
		{ turn: 3, role: "user", text: "is that the september one?", at: T0, step: 5 },
		{
			turn: 3,
			role: "bot",
			text: "Yes, invoice INV-2026-09 for September 2026.",
			at: T0,
			latency_ms: 900,
			step: 5,
		},
	];
}

export function makeConsole(): ConsoleEntry[] {
	return [
		{ level: "log", text: "widget ready", at: T0, step: 1 },
		{ level: "error", text: "GET /favicon.ico 404 (Not Found)", at: T0, step: 1 },
	];
}

export function makeDownloads(bytes = 700): DownloadArtifact[] {
	return [
		{
			path: "downloads/invoice-09.pdf",
			filename: "invoice-09.pdf",
			mime: "application/pdf",
			bytes,
			step: 4,
			turn: 2,
		},
	];
}

/** A valid single-page PDF whose content stream draws `text` with the standard Helvetica font. */
export function minimalPdf(text: string): Uint8Array {
	const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
	const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}

/** 1x1 transparent PNG. */
export const PNG_1X1 = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		"base64",
	),
);

/** In-memory `readFile`: screenshots resolve to the 1x1 PNG, other paths must be in `files`. */
export function memoryReadFile(files: Record<string, Uint8Array> = {}): JudgeInput["readFile"] {
	return async (rel) => {
		const hit = files[rel];
		if (hit) return hit;
		if (rel.endsWith(".png")) return PNG_1X1;
		throw new Error(`memoryReadFile: no such file ${rel}`);
	};
}

export async function makeJudgeInput(overrides: Partial<JudgeInput> = {}): Promise<JudgeInput> {
	return {
		run: makeRun(),
		resolved: await templateResolved(),
		steps: makeSteps(),
		transcript: makeTranscript(),
		downloads: makeDownloads(),
		console: makeConsole(),
		readFile: memoryReadFile({
			"downloads/invoice-09.pdf": minimalPdf("Invoice INV-2026-09 September 2026 total 120.00"),
		}),
		...overrides,
	};
}
