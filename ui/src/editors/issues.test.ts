import { describe, expect, it } from "vitest";
import { groupIssues, issueFor } from "./issues.js";

const issues = [
	{ path: "goal", message: "required" },
	{ path: "criteria.1.weight", message: "must be positive" },
	{ path: "", message: "bad yaml" },
];

describe("issues", () => {
	it("finds the issue for an exact path", () => {
		expect(issueFor(issues, "goal")).toBe("required");
	});

	it("finds issues nested under a path prefix", () => {
		expect(issueFor(issues, "criteria.1")).toBe("weight: must be positive");
		expect(issueFor(issues, "criteria")).toBe("1.weight: must be positive");
	});

	it("returns undefined when nothing matches", () => {
		expect(issueFor(issues, "intent")).toBeUndefined();
		expect(issueFor(issues, "goa")).toBeUndefined();
	});

	it("groups issues into mapped and unmapped ones", () => {
		const groups = groupIssues(issues, ["goal", "criteria"]);
		expect(groups.unmapped).toEqual([{ path: "", message: "bad yaml" }]);
		expect(groups.mapped).toHaveLength(2);
	});
});
