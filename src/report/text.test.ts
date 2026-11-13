import { describe, expect, it } from "vitest";
import { anchorForScreenshot } from "./text.js";

describe("anchorForScreenshot", () => {
	it("turns a run-relative path into a DOM id", () => {
		expect(anchorForScreenshot("steps/003/after.png")).toBe("shot-steps-003-after-png");
		expect(anchorForScreenshot("steps/003/interim-1.png")).toBe("shot-steps-003-interim-1-png");
	});

	it("collapses runs of other characters and trims them at both ends", () => {
		expect(anchorForScreenshot("/steps//003\\after .png/")).toBe("shot-steps-003-after-png");
		expect(anchorForScreenshot("--a--b--")).toBe("shot-a-b");
		expect(anchorForScreenshot("ünïcode/ß.png")).toBe("shot-n-code-png");
	});

	it("keeps only the prefix when the path has no letters or digits", () => {
		expect(anchorForScreenshot("")).toBe("shot-");
		expect(anchorForScreenshot("/-/")).toBe("shot-");
	});

	it("stays linear on long separator-heavy input (CodeQL js/polynomial-redos)", () => {
		const hostile = `${"-".repeat(100_000)}x${"-/".repeat(100_000)}!`;
		const started = performance.now();
		expect(anchorForScreenshot(hostile)).toBe("shot-x");
		expect(performance.now() - started).toBeLessThan(250);
	});
});
