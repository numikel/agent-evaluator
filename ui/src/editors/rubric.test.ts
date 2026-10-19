import { describe, expect, it } from "vitest";
import {
	CRITERION_TYPES,
	type CriterionDraft,
	criterionFields,
	newCriterion,
	previewOutcome,
} from "./rubric.js";

const criteria: CriterionDraft[] = [
	{ id: "tone", type: "llm", description: "polite", weight: 1 },
	{ id: "pdf", type: "file", description: "pdf", weight: 2, required: true },
];

describe("rubric helpers", () => {
	it("lists every criterion type with a label", () => {
		expect(CRITERION_TYPES.map((t) => t.type)).toEqual([
			"llm",
			"contains",
			"regex",
			"file",
			"max_response_time_ms",
			"no_console_errors",
		]);
	});

	it("creates a criterion draft with type-specific defaults", () => {
		expect(newCriterion("contains", 3)).toMatchObject({
			id: "criterion-4",
			type: "contains",
			weight: 1,
			required: false,
			text: "",
			in: "bot",
		});
		expect(newCriterion("max_response_time_ms", 0)).toMatchObject({
			value: 8000,
			aggregate: "max",
		});
	});

	it("exposes type-specific fields", () => {
		expect(criterionFields("regex").map((f) => f.key)).toEqual(["pattern", "flags", "in"]);
		expect(criterionFields("llm").map((f) => f.key)).toEqual(["scale"]);
	});

	it("previews the weighted score including the built-in goal criterion", () => {
		const preview = previewOutcome(criteria, {}, 0.7);
		expect(preview.rows.map((r) => r.id)).toEqual(["goal_reached", "tone", "pdf"]);
		expect(preview.totalWeight).toBe(6);
		expect(preview.score).toBe(1);
		expect(preview.status).toBe("PASSED");
		expect(preview.rows[0]).toMatchObject({ builtin: true, required: true, weight: 3, share: 0.5 });
	});

	it("fails the preview when a required criterion fails even with a high score", () => {
		const preview = previewOutcome(criteria, { pdf: false }, 0.5);
		expect(preview.score).toBeCloseTo(4 / 6);
		expect(preview.status).toBe("FAILED");
		expect(preview.requiredFailed).toBe(true);
	});

	it("fails the preview below the threshold", () => {
		const preview = previewOutcome(criteria, { tone: false, goal_reached: false }, 0.7);
		expect(preview.score).toBeCloseTo(2 / 6);
		expect(preview.status).toBe("FAILED");
	});

	it("does not add goal_reached when the author defines it", () => {
		const own: CriterionDraft[] = [{ id: "goal_reached", type: "llm", weight: 1 }];
		const preview = previewOutcome(own, {}, 0.7);
		expect(preview.rows).toHaveLength(1);
		expect(preview.rows[0]?.builtin).toBe(false);
	});

	it("ignores criteria without a usable weight and copes with an empty list", () => {
		const preview = previewOutcome([{ id: "x", type: "llm", weight: -1 }], {}, 0.7);
		expect(preview.rows.map((r) => r.id)).toEqual(["goal_reached", "x"]);
		expect(preview.rows[1]?.weight).toBe(0);
		expect(previewOutcome([], {}, 0.7).totalWeight).toBe(3);
	});
});
