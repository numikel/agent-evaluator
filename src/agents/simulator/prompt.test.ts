import { describe, expect, it } from "vitest";
import { makeFixture } from "./fixtures.test-helper.js";
import { buildSimulatorSystemPrompt } from "./prompt.js";

describe("buildSimulatorSystemPrompt (seam 1)", () => {
	const { persona, scenario, target } = makeFixture({ maxTurns: 6, language: "pl" });

	it("contains persona body, goal, success criteria, turn counter, target hints and language", () => {
		const prompt = buildSimulatorSystemPrompt({ persona, scenario, target, turn: 1, maxTurns: 6 });
		expect(prompt).toContain(persona.body);
		expect(prompt).toContain(persona.frontmatter.description);
		expect(prompt).toContain("impatient");
		expect(prompt).toContain(scenario.goal);
		expect(prompt).toContain(scenario.intent);
		expect(prompt).toContain(scenario.context as string);
		expect(prompt).toContain(scenario.success_criteria);
		expect(prompt).toContain("Turn 1 of 6");
		expect(prompt).toContain("The chat input is at the bottom of the page.");
		expect(prompt).toContain("pl");
		expect(prompt).toContain("end_conversation");
		expect(prompt).toContain("send_message");
	});

	it("treats examples as inspiration and forbids copying them verbatim", () => {
		const prompt = buildSimulatorSystemPrompt({ persona, scenario, target, turn: 1, maxTurns: 6 });
		expect(prompt).toContain("hi, I need my invoice from September");
		expect(prompt).toContain("where is my invoice?");
		expect(prompt).toMatch(/never copy .*verbatim/i);
	});

	it("adds the vision addendum only when vision is enabled", () => {
		const base = { persona, scenario, target, turn: 2, maxTurns: 6 };
		expect(buildSimulatorSystemPrompt(base)).not.toContain("screenshot_view");
		expect(buildSimulatorSystemPrompt({ ...base, vision: true })).toContain("screenshot_view");
	});

	it("warns on the last turn", () => {
		const prompt = buildSimulatorSystemPrompt({ persona, scenario, target, turn: 6, maxTurns: 6 });
		expect(prompt).toContain("Turn 6 of 6");
		expect(prompt).toMatch(/last turn/i);
	});
});
