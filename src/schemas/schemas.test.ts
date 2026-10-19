import { describe, expect, it } from "vitest";
import {
	computeOutcome,
	EvaluatorConfigSchema,
	MODEL_REF_PATTERN,
	ModelInfoSchema,
	PersonaFrontmatterSchema,
	ProviderModelsResponseSchema,
	parseWith,
	RubricSchema,
	RunEventSchema,
	ScenarioSchema,
	SettingsSchema,
	TargetSchema,
	ValidationError,
	VerdictSchema,
	withBuiltinCriteria,
} from "./index.js";

describe("persona frontmatter", () => {
	it("accepts a minimal persona and applies defaults", () => {
		const p = PersonaFrontmatterSchema.parse({
			name: "impatient-smb-owner",
			description: "Small business owner in a hurry",
		});
		expect(p.language).toBe("en");
		expect(p.traits).toEqual([]);
		expect(p.interaction_style).toEqual([]);
		expect(p.version).toBe(1);
	});

	it("rejects names that are not kebab-case slugs", () => {
		expect(() => PersonaFrontmatterSchema.parse({ name: "Bad Name", description: "x" })).toThrow();
	});
});

describe("scenario", () => {
	const base = {
		name: "invoice-export",
		persona: "impatient-smb-owner",
		target: "demo-chatbot",
		goal: "Download the September invoice as PDF",
		intent: "The user wants a PDF invoice for September and nothing else",
		success_criteria: "A PDF file was downloaded and the bot confirmed it covers September",
		max_turns: 6,
	};

	it("accepts a scenario with defaults", () => {
		const s = ScenarioSchema.parse(base);
		expect(s.repeat).toBe(1);
		expect(s.vision).toBe(false);
		expect(s.examples).toEqual([]);
		expect(s.expected_artifacts).toEqual([]);
	});

	it("requires max_turns to be a positive integer", () => {
		expect(() => ScenarioSchema.parse({ ...base, max_turns: 0 })).toThrow();
		expect(() => ScenarioSchema.parse({ ...base, max_turns: 2.5 })).toThrow();
	});

	it("validates expected artifacts", () => {
		const s = ScenarioSchema.parse({
			...base,
			expected_artifacts: [{ type: "download", mime: "application/pdf" }],
		});
		expect(s.expected_artifacts[0]?.type).toBe("download");
	});
});

describe("rubric", () => {
	it("applies defaults to criteria and threshold", () => {
		const r = RubricSchema.parse({
			name: "support",
			criteria: [{ id: "tone", type: "llm", description: "Polite and concise" }],
		});
		expect(r.pass_threshold).toBe(0.7);
		expect(r.criteria[0]).toMatchObject({ weight: 1, required: false, scale: "0-5" });
	});

	it("validates type-specific fields", () => {
		expect(() =>
			RubricSchema.parse({
				name: "x",
				criteria: [{ id: "rt", type: "max_response_time_ms", description: "fast" }],
			}),
		).toThrow();
		const r = RubricSchema.parse({
			name: "x",
			criteria: [
				{ id: "rt", type: "max_response_time_ms", description: "fast", value: 8000 },
				{ id: "pdf", type: "file", description: "pdf", mime: "application/pdf" },
				{ id: "re", type: "regex", description: "re", pattern: "Sept(ember)?", flags: "i" },
				{ id: "c", type: "contains", description: "c", text: "invoice" },
				{ id: "ce", type: "no_console_errors", description: "clean console" },
			],
		});
		expect(r.criteria).toHaveLength(5);
	});

	it("rejects duplicate criterion ids", () => {
		expect(() =>
			RubricSchema.parse({
				name: "x",
				criteria: [
					{ id: "a", type: "llm", description: "a" },
					{ id: "a", type: "llm", description: "b" },
				],
			}),
		).toThrow(/duplicate/i);
	});

	it("withBuiltinCriteria prepends goal_reached as required weight 3 unless overridden", () => {
		const r = withBuiltinCriteria(
			RubricSchema.parse({ name: "x", criteria: [{ id: "a", type: "llm", description: "a" }] }),
		);
		expect(r.criteria[0]).toMatchObject({ id: "goal_reached", required: true, weight: 3 });
		const overridden = withBuiltinCriteria(
			RubricSchema.parse({
				name: "x",
				criteria: [{ id: "goal_reached", type: "llm", description: "custom", weight: 5 }],
			}),
		);
		expect(overridden.criteria).toHaveLength(1);
		expect(overridden.criteria[0]?.weight).toBe(5);
	});
});

describe("target", () => {
	it("applies timeout and viewport defaults", () => {
		const t = TargetSchema.parse({ name: "demo-chatbot", url: "http://localhost:3999" });
		expect(t.timeouts).toEqual({
			response_ms: 60_000,
			stable_ms: 1500,
			navigation_ms: 30_000,
			capture_interval_ms: 2000,
		});
		expect(t.viewport).toEqual({ width: 1280, height: 800 });
		expect(t.headless).toBe(true);
		expect(t.vision).toBe(false);
	});

	it("rejects non-http urls", () => {
		expect(() => TargetSchema.parse({ name: "x", url: "ftp://x" })).toThrow();
	});
});

describe("evaluator config", () => {
	it("defaults max_images and evidence selection", () => {
		const e = EvaluatorConfigSchema.parse({ principles: "Be strict." });
		expect(e.max_images).toBe(10);
		expect(e.evidence_selection).toBe("llm");
	});
});

describe("settings", () => {
	it("requires explicit provider:model references", () => {
		expect(MODEL_REF_PATTERN.test("anthropic:claude-sonnet-5-5")).toBe(true);
		expect(MODEL_REF_PATTERN.test("claude-sonnet-5-5")).toBe(false);
		expect(() => SettingsSchema.parse({ models: { simulator: "gpt-5", judge: "x:y" } })).toThrow();
	});

	it("accepts per-role effort levels and rejects unknown ones", () => {
		const s = SettingsSchema.parse({ effort: { judge: "high" } });
		expect(s.effort?.judge).toBe("high");
		expect(() => SettingsSchema.parse({ effort: { judge: "turbo" } })).toThrow();
	});

	it("applies defaults", () => {
		const s = SettingsSchema.parse({});
		expect(s.models.simulator).toBe("anthropic:claude-sonnet-5-5");
		expect(s.models.judge).toBe("anthropic:claude-sonnet-5-5");
		expect(s.concurrency).toBe(1);
		expect(s.runs_dir).toBe("runs");
		expect(s.browser.headless).toBe(true);
		expect(s.temperature).toBeUndefined();
	});
});

describe("api DTOs", () => {
	it("ModelInfo carries a full provider:model ref", () => {
		const m = ModelInfoSchema.parse({
			provider: "openrouter",
			id: "anthropic/claude-sonnet-5-5",
			label: "Claude Sonnet 5.5",
			ref: "openrouter:anthropic/claude-sonnet-5-5",
			context_window: 1_000_000,
		});
		expect(m.ref).toMatch(MODEL_REF_PATTERN);
		expect(() =>
			ProviderModelsResponseSchema.parse({
				provider: "x",
				models: [],
				fetched_at: "now",
				source: "cache",
			}),
		).toThrow();
	});
});

describe("run events", () => {
	it("discriminates by type", () => {
		const ev = RunEventSchema.parse({
			type: "step",
			runId: "r1",
			at: "2026-10-19T00:00:00.000Z",
			step: { index: 1, action: { kind: "click", ref: "e3" }, screenshot: "steps/001/after.png" },
		});
		expect(ev.type).toBe("step");
		expect(() => RunEventSchema.parse({ type: "nope", runId: "r1", at: "x" })).toThrow();
	});
});

describe("verdict & outcome", () => {
	const goal = {
		id: "goal_reached",
		score: 1,
		pass: true,
		weight: 3,
		required: true,
		reason: "ok",
		evidence: [],
	};
	const tone = {
		id: "tone",
		score: 0.5,
		pass: true,
		weight: 1,
		required: false,
		reason: "meh",
		evidence: [],
	};
	const criteria = [goal, tone];

	it("computes weighted score and pass", () => {
		const o = computeOutcome({ criteria, goalReached: true, passThreshold: 0.7 });
		expect(o.score).toBeCloseTo((3 * 1 + 1 * 0.5) / 4);
		expect(o.status).toBe("PASSED");
	});

	it("fails when goal not reached even with high score", () => {
		const o = computeOutcome({ criteria, goalReached: false, passThreshold: 0.5 });
		expect(o.status).toBe("FAILED");
		expect(o.score).toBeGreaterThan(0.5);
	});

	it("fails when a required criterion fails", () => {
		const o = computeOutcome({
			criteria: [{ ...goal, pass: false, score: 0 }, tone],
			goalReached: true,
			passThreshold: 0.1,
		});
		expect(o.status).toBe("FAILED");
	});

	it("fails below threshold", () => {
		const o = computeOutcome({ criteria, goalReached: true, passThreshold: 0.95 });
		expect(o.status).toBe("FAILED");
	});

	it("VerdictSchema round-trips", () => {
		const v = VerdictSchema.parse({
			runId: "r1",
			status: "PASSED",
			goal_reached: true,
			score: 0.875,
			pass_threshold: 0.7,
			turns_used: 3,
			max_turns: 6,
			criteria,
			summary: "Good",
			judged_at: "2026-10-19T00:00:00.000Z",
			judge_model: "anthropic:claude-sonnet-5-5",
		});
		expect(v.score).toBe(0.875);
	});
});

describe("parseWith", () => {
	it("returns a ValidationError with a readable message", () => {
		const r = parseWith(ScenarioSchema, { name: "x" }, "scenarios/x.yaml");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toBeInstanceOf(ValidationError);
			expect(r.error.message).toContain("scenarios/x.yaml");
			expect(r.error.issues.length).toBeGreaterThan(0);
		}
	});
});
