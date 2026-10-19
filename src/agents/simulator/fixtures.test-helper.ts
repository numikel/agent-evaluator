import {
	type Persona,
	PersonaSchema,
	type Scenario,
	ScenarioSchema,
	type Target,
	TargetSchema,
} from "../../schemas/index.js";

export type SimulatorFixture = { persona: Persona; scenario: Scenario; target: Target };

/** Minimal valid persona + scenario + target for simulator tests. */
export function makeFixture(
	overrides: { maxTurns?: number; vision?: boolean; hints?: string[]; language?: string } = {},
): SimulatorFixture {
	const persona = PersonaSchema.parse({
		frontmatter: {
			name: "impatient-smb-owner",
			description: "Runs a small bakery, hates waiting.",
			language: overrides.language ?? "en",
			traits: ["impatient", "non-technical"],
			interaction_style: ["short-messages"],
		},
		body: "Marta owns a bakery and needs her September invoice before the accountant calls.",
	});
	const scenario = ScenarioSchema.parse({
		name: "get-invoice",
		persona: "impatient-smb-owner",
		target: "demo",
		goal: "Obtain the September invoice as a PDF",
		intent: "The user wants a copy of last month's invoice",
		context: "The user is logged in and has an active subscription.",
		opening_message_example: "hi, I need my invoice from September",
		examples: ["where is my invoice?"],
		success_criteria: "The bot provides a downloadable invoice PDF for September.",
		max_turns: overrides.maxTurns ?? 6,
		vision: overrides.vision ?? false,
	});
	const target = TargetSchema.parse({
		name: "demo",
		url: "http://localhost:3999",
		hints: overrides.hints ?? ["The chat input is at the bottom of the page."],
		timeouts: { response_ms: 5000, stable_ms: 100, capture_interval_ms: 50 },
	});
	return { persona, scenario, target };
}
