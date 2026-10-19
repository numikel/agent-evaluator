import { describe, expect, it } from "vitest";
import { CriterionSchema } from "../../schemas/index.js";
import {
	type DeterministicCriterion,
	evaluateDeterministic,
	isDeterministic,
} from "./deterministic.js";
import { makeConsole, makeDownloads, makeTranscript, T0 } from "./test-fixtures.js";
import type { ExtractedFile } from "./types.js";

const parse = (input: Record<string, unknown>) =>
	CriterionSchema.parse({ id: "c", description: "d", ...input });

const criterion = (input: Record<string, unknown>): DeterministicCriterion => {
	const parsed = parse(input);
	if (!isDeterministic(parsed)) throw new Error("deterministic criterion expected");
	return parsed;
};

const files: ExtractedFile[] = [
	{ ...(makeDownloads()[0] as ExtractedFile), text: "Invoice INV-2026-09 September 2026" },
];

const ctx = { transcript: makeTranscript(), files, console: makeConsole() };

describe("isDeterministic", () => {
	it("is false only for llm criteria", () => {
		expect(isDeterministic(parse({ type: "llm" }))).toBe(false);
		expect(isDeterministic(parse({ type: "contains", text: "x" }))).toBe(true);
	});
});

describe("contains (seam 1)", () => {
	it("matches bot replies case-insensitively by default and cites the turn", () => {
		const result = evaluateDeterministic(criterion({ type: "contains", text: "SEPTEMBER" }), ctx);
		expect(result.pass).toBe(true);
		expect(result.score).toBe(1);
		expect(result.evidence[0]).toMatchObject({ turn: 2, step: 3 });
		expect(result.evidence[0]?.quote).toContain("September");
	});

	it("respects case_sensitive", () => {
		const result = evaluateDeterministic(
			criterion({ type: "contains", text: "SEPTEMBER", case_sensitive: true }),
			ctx,
		);
		expect(result.pass).toBe(false);
		expect(result.score).toBe(0);
	});

	it("looks only at user messages for in: user", () => {
		const bot = evaluateDeterministic(criterion({ type: "contains", text: "4471" }), ctx);
		expect(bot.pass).toBe(false);
		const user = evaluateDeterministic(
			criterion({ type: "contains", text: "4471", in: "user" }),
			ctx,
		);
		expect(user.pass).toBe(true);
		expect(user.evidence[0]).toMatchObject({ turn: 2 });
	});

	it("searches extracted file text for in: files and cites the download step", () => {
		const result = evaluateDeterministic(
			criterion({ type: "contains", text: "INV-2026-09", in: "files" }),
			ctx,
		);
		expect(result.pass).toBe(true);
		expect(result.evidence[0]).toMatchObject({ step: 4, turn: 2 });
		expect(result.reason).toContain("invoice-09.pdf");
	});

	it("in: any searches everything", () => {
		const result = evaluateDeterministic(
			criterion({ type: "contains", text: "total 120", in: "any" }),
			{ ...ctx, files: [{ ...(files[0] as ExtractedFile), text: "total 120.00" }] },
		);
		expect(result.pass).toBe(true);
	});

	it("carries weight and required through", () => {
		const result = evaluateDeterministic(
			criterion({ type: "contains", text: "nope", weight: 2.5, required: true }),
			ctx,
		);
		expect(result).toMatchObject({ id: "c", pass: false, weight: 2.5, required: true });
		expect(result.reason).toMatch(/not found/i);
	});
});

describe("regex (seam 1)", () => {
	it("matches with flags and quotes the match", () => {
		const result = evaluateDeterministic(
			criterion({ type: "regex", pattern: "sept(ember)?", flags: "i", in: "bot" }),
			ctx,
		);
		expect(result.pass).toBe(true);
		expect(result.evidence[0]?.quote).toMatch(/September/);
		expect(result.raw).toMatchObject({ matches: 2 });
	});

	it("fails without throwing on an invalid pattern", () => {
		const result = evaluateDeterministic(criterion({ type: "regex", pattern: "(" }), ctx);
		expect(result.pass).toBe(false);
		expect(result.reason).toMatch(/invalid/i);
	});

	it("a global flag does not skip alternate entries", () => {
		const result = evaluateDeterministic(
			criterion({ type: "regex", pattern: "invoice", flags: "gi" }),
			ctx,
		);
		expect(result.evidence).toHaveLength(2);
	});
});

describe("file (seam 1)", () => {
	it("passes for a PDF download matching mime, min_bytes and contains", () => {
		const result = evaluateDeterministic(
			criterion({
				type: "file",
				mime: "application/pdf",
				min_bytes: 500,
				contains: "september",
			}),
			ctx,
		);
		expect(result.pass).toBe(true);
		expect(result.score).toBe(1);
		expect(result.evidence[0]).toMatchObject({ step: 4, turn: 2 });
		expect(result.raw).toMatchObject({ matched: "downloads/invoice-09.pdf" });
	});

	it("accepts type/* globs", () => {
		const result = evaluateDeterministic(criterion({ type: "file", mime: "application/*" }), ctx);
		expect(result.pass).toBe(true);
	});

	it("fails on mime mismatch and explains why", () => {
		const result = evaluateDeterministic(criterion({ type: "file", mime: "text/csv" }), ctx);
		expect(result.pass).toBe(false);
		expect(result.score).toBe(0);
		expect(result.reason).toMatch(/mime/i);
	});

	it("fails when the file is too small", () => {
		const result = evaluateDeterministic(criterion({ type: "file", min_bytes: 10_000 }), ctx);
		expect(result.pass).toBe(false);
		expect(result.reason).toMatch(/bytes/i);
	});

	it("fails when nothing was downloaded", () => {
		const result = evaluateDeterministic(criterion({ type: "file" }), { ...ctx, files: [] });
		expect(result.pass).toBe(false);
		expect(result.reason).toMatch(/no files/i);
	});
});

describe("max_response_time_ms (seam 1)", () => {
	it("max aggregate compares the slowest bot reply", () => {
		const slow = evaluateDeterministic(
			criterion({ type: "max_response_time_ms", value: 2000, aggregate: "max" }),
			ctx,
		);
		expect(slow.pass).toBe(false);
		expect(slow.raw).toMatchObject({ aggregate: "max", measured_ms: 2600, samples: 3 });
		expect(slow.evidence[0]).toMatchObject({ turn: 2, step: 3 });
		const fast = evaluateDeterministic(
			criterion({ type: "max_response_time_ms", value: 3000, aggregate: "max" }),
			ctx,
		);
		expect(fast.pass).toBe(true);
	});

	it("p95 uses nearest-rank over the latency samples", () => {
		const transcript = Array.from({ length: 20 }, (_, i) => ({
			turn: i + 1,
			role: "bot" as const,
			text: "r",
			at: T0,
			latency_ms: (i + 1) * 100, // 100..2000
		}));
		const result = evaluateDeterministic(
			criterion({ type: "max_response_time_ms", value: 1900, aggregate: "p95" }),
			{ ...ctx, transcript },
		);
		expect(result.raw).toMatchObject({ measured_ms: 1900 });
		expect(result.pass).toBe(true);
	});

	it("p50 picks the median sample", () => {
		const result = evaluateDeterministic(
			criterion({ type: "max_response_time_ms", value: 1000, aggregate: "p50" }),
			ctx,
		);
		expect(result.raw).toMatchObject({ measured_ms: 1200 });
		expect(result.pass).toBe(false);
	});

	it("passes vacuously without latency samples", () => {
		const result = evaluateDeterministic(criterion({ type: "max_response_time_ms", value: 1 }), {
			...ctx,
			transcript: [],
		});
		expect(result.pass).toBe(true);
		expect(result.reason).toMatch(/no bot replies/i);
	});
});

describe("no_console_errors (seam 1)", () => {
	it("fails on console errors and cites the step", () => {
		const result = evaluateDeterministic(criterion({ type: "no_console_errors" }), ctx);
		expect(result.pass).toBe(false);
		expect(result.evidence[0]).toMatchObject({ step: 1 });
		expect(result.evidence[0]?.quote).toContain("favicon");
	});

	it("honours ignore patterns and ignores warnings", () => {
		const result = evaluateDeterministic(
			criterion({ type: "no_console_errors", ignore: ["favicon"] }),
			{ ...ctx, console: [...ctx.console, { level: "warn", text: "deprecated", at: T0 }] },
		);
		expect(result.pass).toBe(true);
		expect(result.raw).toMatchObject({ errors: 0, ignored: 1 });
	});
});
