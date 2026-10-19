import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { failedMaxTurnsFixture, passedFixture } from "./fixtures/index.js";
import { renderJUnit } from "./junit.js";

/** Parses with jsdom's XML parser; a malformed document yields a `parsererror` element. */
function parseXml(xml: string): Document {
	const { window } = new JSDOM("");
	const doc = new window.DOMParser().parseFromString(xml, "application/xml");
	const error = doc.getElementsByTagName("parsererror")[0];
	if (error) throw new Error(`malformed XML: ${error.textContent}`);
	return doc;
}

const attr = (el: Element | null | undefined, name: string) => el?.getAttribute(name) ?? undefined;

describe("renderJUnit", () => {
	it("emits one passing testcase per criterion for a PASSED run", () => {
		const xml = renderJUnit(passedFixture());
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		const doc = parseXml(xml);
		const suite = doc.querySelector("testsuite");
		expect(attr(suite, "name")).toBe("invoice-export-september");
		expect(attr(suite, "tests")).toBe("8");
		expect(attr(suite, "failures")).toBe("0");
		expect(attr(suite, "errors")).toBe("0");
		const cases = [...doc.querySelectorAll("testcase")];
		expect(cases.map((c) => attr(c, "name"))).toEqual([
			"goal_reached",
			"tone",
			"no_hallucinated_data",
			"stays_on_task",
			"pdf_delivered",
			"mentions_month",
			"fast_enough",
			"clean_console",
		]);
		expect(doc.querySelectorAll("failure")).toHaveLength(0);
		const root = doc.documentElement;
		expect(root.tagName).toBe("testsuites");
		expect(attr(root, "tests")).toBe("8");
		expect(attr(root, "failures")).toBe("0");
	});

	it("marks failed criteria with <failure message=reason> and counts them on the suite", () => {
		const doc = parseXml(renderJUnit(failedMaxTurnsFixture()));
		const suite = doc.querySelector("testsuite");
		expect(attr(suite, "tests")).toBe("8");
		expect(attr(suite, "failures")).toBe("5");
		const failed = [...doc.querySelectorAll("testcase")].filter((c) => c.querySelector("failure"));
		expect(failed.map((c) => attr(c, "name"))).toEqual([
			"goal_reached",
			"stays_on_task",
			"pdf_delivered",
			"fast_enough",
			"clean_console",
		]);
		const goal = doc.querySelector('testcase[name="goal_reached"] > failure');
		expect(attr(goal, "message")).toBe(
			"No PDF was downloaded within 4 turns; the bot ended by redirecting the user to billing@example.com.",
		);
	});

	it("adds a run-level failure when the run failed although every criterion passed", () => {
		const input = passedFixture();
		input.verdict.status = "FAILED";
		input.run.status = "FAILED";
		input.verdict.score = 0.5;
		const doc = parseXml(renderJUnit(input));
		const suite = doc.querySelector("testsuite");
		expect(attr(suite, "failures")).toBe("1");
		expect(attr(suite, "tests")).toBe("9");
		const run = doc.querySelector('testcase[name="run"] > failure');
		expect(attr(run, "message")).toMatch(/50%.*70%/);
	});

	it("reports a run that errored out as a suite error", () => {
		const input = passedFixture();
		input.run.status = "ERROR";
		input.run.error = "Target unreachable: ECONNREFUSED <localhost:3999>";
		const doc = parseXml(renderJUnit(input));
		expect(attr(doc.querySelector("testsuite"), "errors")).toBe("1");
		const error = doc.querySelector('testcase[name="run"] > error');
		expect(attr(error, "message")).toBe("Target unreachable: ECONNREFUSED <localhost:3999>");
	});

	it("escapes XML special characters and strips control characters from text", () => {
		const input = failedMaxTurnsFixture();
		const tone = input.verdict.criteria.find((c) => c.id === "tone");
		if (!tone) throw new Error("fixture lost the tone criterion");
		tone.pass = false;
		tone.reason = 'Said "<b>hi</b>" & waved \u0007 at the user';
		const xml = renderJUnit(input);
		expect(xml).not.toContain("<b>hi</b>");
		expect(xml).not.toContain("\u0007");
		const doc = parseXml(xml);
		expect(attr(doc.querySelector('testcase[name="tone"] > failure'), "message")).toBe(
			'Said "<b>hi</b>" & waved  at the user',
		);
	});
});
