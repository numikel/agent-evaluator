/**
 * Deterministic criteria: computed in code from the transcript, extracted files and console log.
 * Each evaluator returns a full `CriterionResult` (score 0/1, `raw` measurement, evidence refs).
 */
import type {
	ConsoleEntry,
	Criterion,
	CriterionResult,
	EvidenceRef,
	TranscriptEntry,
} from "../../schemas/index.js";
import type { ExtractedFile } from "./types.js";

export type DeterministicContext = {
	transcript: TranscriptEntry[];
	files: ExtractedFile[];
	console: ConsoleEntry[];
};

export type DeterministicCriterion = Exclude<Criterion, { type: "llm" }>;

export function isDeterministic(criterion: Criterion): criterion is DeterministicCriterion {
	return criterion.type !== "llm";
}

const QUOTE_LENGTH = 160;

/** A short excerpt around `index` (or the start) of `text`. */
function quote(text: string, index = 0, length = QUOTE_LENGTH): string {
	const start = Math.max(0, index - Math.floor(length / 4));
	const slice = text
		.slice(start, start + length)
		.replace(/\s+/g, " ")
		.trim();
	return `${start > 0 ? "…" : ""}${slice}${start + length < text.length ? "…" : ""}`;
}

type Haystack = { label: string; text: string; ref: EvidenceRef };

function haystacks(scope: "bot" | "user" | "files" | "any", ctx: DeterministicContext): Haystack[] {
	const out: Haystack[] = [];
	if (scope === "bot" || scope === "user" || scope === "any") {
		for (const entry of ctx.transcript) {
			if (scope !== "any" && entry.role !== scope) continue;
			const ref: EvidenceRef = { turn: entry.turn };
			if (entry.step !== undefined) ref.step = entry.step;
			out.push({ label: `${entry.role} turn ${entry.turn}`, text: entry.text, ref });
		}
	}
	if (scope === "files" || scope === "any") {
		for (const file of ctx.files) {
			const ref: EvidenceRef = {};
			if (file.step !== undefined) ref.step = file.step;
			if (file.turn !== undefined) ref.turn = file.turn;
			out.push({ label: `file ${file.filename}`, text: file.text, ref });
		}
	}
	return out;
}

function base(
	criterion: DeterministicCriterion,
	pass: boolean,
	reason: string,
	evidence: EvidenceRef[],
	raw: unknown,
): CriterionResult {
	return {
		id: criterion.id,
		score: pass ? 1 : 0,
		pass,
		weight: criterion.weight,
		required: criterion.required,
		reason,
		evidence,
		raw,
	};
}

function evaluateContains(
	criterion: Extract<Criterion, { type: "contains" }>,
	ctx: DeterministicContext,
): CriterionResult {
	const needle = criterion.case_sensitive ? criterion.text : criterion.text.toLowerCase();
	const evidence: EvidenceRef[] = [];
	const where: string[] = [];
	for (const h of haystacks(criterion.in, ctx)) {
		const text = criterion.case_sensitive ? h.text : h.text.toLowerCase();
		const index = text.indexOf(needle);
		if (index < 0) continue;
		evidence.push({ ...h.ref, quote: quote(h.text, index) });
		where.push(h.label);
	}
	const pass = evidence.length > 0;
	const reason = pass
		? `"${criterion.text}" found in ${where.join(", ")}.`
		: `"${criterion.text}" not found in ${criterion.in} messages.`;
	return base(criterion, pass, reason, evidence, { matches: evidence.length, in: criterion.in });
}

function evaluateRegex(
	criterion: Extract<Criterion, { type: "regex" }>,
	ctx: DeterministicContext,
): CriterionResult {
	// `g`/`y` make `exec` stateful; drop them so every haystack is searched from its start.
	const flags = criterion.flags.replace(/[gy]/g, "");
	let regex: RegExp;
	try {
		regex = new RegExp(criterion.pattern, flags);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return base(criterion, false, `Invalid pattern: ${message}`, [], { error: message });
	}
	const evidence: EvidenceRef[] = [];
	const where: string[] = [];
	for (const h of haystacks(criterion.in, ctx)) {
		const match = regex.exec(h.text);
		if (!match) continue;
		evidence.push({ ...h.ref, quote: quote(h.text, match.index) });
		where.push(h.label);
	}
	const pass = evidence.length > 0;
	const reason = pass
		? `/${criterion.pattern}/${criterion.flags} matched ${where.join(", ")}.`
		: `/${criterion.pattern}/${criterion.flags} matched nothing in ${criterion.in} messages.`;
	return base(criterion, pass, reason, evidence, { matches: evidence.length, in: criterion.in });
}

/** `type/*` or exact, case-insensitive; parameters (`; charset=`) are ignored. */
export function mimeMatches(pattern: string, mime: string | undefined): boolean {
	if (!mime) return false;
	const actual = mime.split(";")[0]?.trim().toLowerCase() ?? "";
	const expected = pattern.trim().toLowerCase();
	if (expected === "*" || expected === "*/*") return true;
	if (expected.endsWith("/*")) return actual.startsWith(expected.slice(0, -1));
	return actual === expected;
}

function evaluateFile(
	criterion: Extract<Criterion, { type: "file" }>,
	ctx: DeterministicContext,
): CriterionResult {
	if (ctx.files.length === 0) {
		return base(criterion, false, "No files were downloaded during the run.", [], { files: 0 });
	}
	const rejections: string[] = [];
	for (const file of ctx.files) {
		const why: string[] = [];
		if (criterion.mime !== undefined && !mimeMatches(criterion.mime, file.mime)) {
			why.push(`mime ${file.mime ?? "unknown"} does not match ${criterion.mime}`);
		}
		if (criterion.min_bytes !== undefined && file.bytes < criterion.min_bytes) {
			why.push(`${file.bytes} bytes < min_bytes ${criterion.min_bytes}`);
		}
		if (criterion.contains !== undefined) {
			const haystack = file.text.toLowerCase();
			if (!haystack.includes(criterion.contains.toLowerCase())) {
				why.push(
					file.error
						? `text could not be extracted (${file.error})`
						: `extracted text does not contain "${criterion.contains}"`,
				);
			}
		}
		if (why.length === 0) {
			const ref: EvidenceRef = {
				quote: `${file.filename} (${file.mime ?? "?"}, ${file.bytes} bytes)`,
			};
			if (file.step !== undefined) ref.step = file.step;
			if (file.turn !== undefined) ref.turn = file.turn;
			return base(criterion, true, `${file.filename} satisfies every file condition.`, [ref], {
				matched: file.path,
				mime: file.mime,
				bytes: file.bytes,
				files: ctx.files.length,
			});
		}
		rejections.push(`${file.filename}: ${why.join("; ")}`);
	}
	return base(
		criterion,
		false,
		`No downloaded file satisfies the conditions. ${rejections.join(" | ")}`,
		[],
		{ files: ctx.files.length, rejections },
	);
}

/** Nearest-rank percentile over `sorted` ascending samples (p in 0..1). */
function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
	return sorted[rank - 1] ?? 0;
}

function evaluateMaxResponseTime(
	criterion: Extract<Criterion, { type: "max_response_time_ms" }>,
	ctx: DeterministicContext,
): CriterionResult {
	const replies = ctx.transcript.filter(
		(e): e is TranscriptEntry & { latency_ms: number } =>
			e.role === "bot" && typeof e.latency_ms === "number",
	);
	if (replies.length === 0) {
		return base(criterion, true, "No bot replies with measured latency; nothing to check.", [], {
			aggregate: criterion.aggregate,
			samples: 0,
		});
	}
	const sorted = replies.map((r) => r.latency_ms).sort((a, b) => a - b);
	const measured =
		criterion.aggregate === "max"
			? (sorted[sorted.length - 1] ?? 0)
			: percentile(sorted, criterion.aggregate === "p95" ? 0.95 : 0.5);
	const pass = measured <= criterion.value;
	const slowest = replies.reduce((a, b) => (b.latency_ms > a.latency_ms ? b : a));
	const ref: EvidenceRef = {
		turn: slowest.turn,
		quote: `slowest reply ${slowest.latency_ms} ms (turn ${slowest.turn})`,
	};
	if (slowest.step !== undefined) ref.step = slowest.step;
	return base(
		criterion,
		pass,
		`${criterion.aggregate} latency ${measured} ms ${pass ? "≤" : ">"} ${criterion.value} ms over ${replies.length} bot replies.`,
		[ref],
		{
			aggregate: criterion.aggregate,
			measured_ms: measured,
			limit_ms: criterion.value,
			samples: replies.length,
			latencies_ms: sorted,
		},
	);
}

function evaluateNoConsoleErrors(
	criterion: Extract<Criterion, { type: "no_console_errors" }>,
	ctx: DeterministicContext,
): CriterionResult {
	const ignore = criterion.ignore.flatMap((p) => {
		try {
			return [new RegExp(p, "i")];
		} catch {
			return [];
		}
	});
	const errors = ctx.console.filter((e) => e.level === "error");
	const kept = errors.filter((e) => !ignore.some((re) => re.test(e.text)));
	const evidence = kept.slice(0, 20).map((e) => {
		const ref: EvidenceRef = { quote: quote(e.text) };
		if (e.step !== undefined) ref.step = e.step;
		return ref;
	});
	const pass = kept.length === 0;
	const ignored = errors.length - kept.length;
	const reason = pass
		? `No console errors${ignored > 0 ? ` (${ignored} ignored by pattern)` : ""}.`
		: `${kept.length} console error(s) logged${ignored > 0 ? ` (${ignored} ignored)` : ""}.`;
	return base(criterion, pass, reason, evidence, { errors: kept.length, ignored });
}

/** Evaluates one deterministic criterion. Never throws. */
export function evaluateDeterministic(
	criterion: DeterministicCriterion,
	ctx: DeterministicContext,
): CriterionResult {
	switch (criterion.type) {
		case "contains":
			return evaluateContains(criterion, ctx);
		case "regex":
			return evaluateRegex(criterion, ctx);
		case "file":
			return evaluateFile(criterion, ctx);
		case "max_response_time_ms":
			return evaluateMaxResponseTime(criterion, ctx);
		case "no_console_errors":
			return evaluateNoConsoleErrors(criterion, ctx);
	}
}
