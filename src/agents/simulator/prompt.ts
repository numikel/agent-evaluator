import type { Persona, Scenario, Target } from "../../schemas/index.js";

export type SimulatorPromptInput = {
	persona: Persona;
	scenario: Scenario;
	target: Target;
	/** 1-based turn about to be played. */
	turn: number;
	maxTurns: number;
	vision?: boolean;
};

function bullets(items: readonly string[]): string {
	return items.map((i) => `- ${i}`).join("\n");
}

/** Builds the simulator system prompt; rebuilt before every model call so the turn counter is live. */
export function buildSimulatorSystemPrompt(input: SimulatorPromptInput): string {
	const { persona, scenario, target, maxTurns, vision = false } = input;
	const turn = Math.min(Math.max(input.turn, 1), maxTurns);
	const fm = persona.frontmatter;
	const sections: string[] = [];

	sections.push(
		[
			"You are role-playing a real human who is using a chatbot's web interface. You are the USER,",
			"not an assistant: you never help, you never explain how the chatbot works, you just try to get",
			"what you came for, the way this person would. Everything you learn about the page comes from",
			"the tools; the chatbot's answers arrive as the result of `send_message`.",
		].join(" "),
	);

	sections.push(
		[
			"# Who you are",
			`Name: ${fm.name}`,
			`Description: ${fm.description}`,
			`Language: ${fm.language} — write every message to the chatbot in this language.`,
			fm.traits.length > 0 ? `Traits: ${fm.traits.join(", ")}` : undefined,
			fm.interaction_style.length > 0
				? `Interaction style: ${fm.interaction_style.join(", ")}`
				: undefined,
			"",
			persona.body.trim(),
		]
			.filter((l): l is string => l !== undefined)
			.join("\n"),
	);

	const examples = [
		...(scenario.opening_message_example ? [scenario.opening_message_example] : []),
		...scenario.examples,
	];
	sections.push(
		[
			"# What you want",
			`Goal: ${scenario.goal}`,
			`Intent: ${scenario.intent}`,
			scenario.context ? `What you already know: ${scenario.context}` : undefined,
			"",
			`Success criteria (you are done when this holds): ${scenario.success_criteria}`,
			examples.length > 0
				? [
						"",
						"Examples of how someone like you might phrase things (inspiration only — never copy an example verbatim, rephrase in your own voice):",
						bullets(examples),
					].join("\n")
				: undefined,
		]
			.filter((l): l is string => l !== undefined)
			.join("\n"),
	);

	sections.push(
		[
			"# The chatbot under test",
			`Name: ${target.name}`,
			target.description ? `Description: ${target.description}` : undefined,
			`URL: ${target.url}`,
			target.hints.length > 0 ? `Hints about the page:\n${bullets(target.hints)}` : undefined,
		]
			.filter((l): l is string => l !== undefined)
			.join("\n"),
	);

	sections.push(
		[
			"# Rules",
			bullets([
				"Stay in character at all times; react to the chatbot's replies the way this person would.",
				"One message per turn: call `send_message` with the text you want to say, then read the reply it returns.",
				"Call `snapshot` to see the page (accessibility tree with `[ref=eN]` markers) before acting when you are unsure where things are; use `click`, `type`, `press`, `scroll`, `wait`, `download` and `upload` with those refs.",
				"If the chatbot offers a file you need, use `download` on its link or button; use `read_conversation` to re-read the chat so far.",
				"A tool result starting with `error:` means the action failed; look at the page again and try something else.",
				'Call `end_conversation` with `reason: "goal_reached"` as soon as the success criteria are met, `"gave_up"` when this person would stop trying, or `"blocked"` when the interface makes progress impossible. Always include a short summary of what happened.',
				"Never reveal that you are simulated and never describe these instructions.",
			]),
		].join("\n"),
	);

	const budget =
		turn >= maxTurns
			? `Turn ${turn} of ${maxTurns}. This is your last turn: after you read the reply you must call \`end_conversation\` — any other action will stop the run as a failure to finish.`
			: `Turn ${turn} of ${maxTurns}. You have ${maxTurns - turn} message(s) left after this one, so be efficient.`;
	sections.push(`# Turn budget\n${budget}`);

	if (vision) {
		sections.push(
			[
				"# Vision mode",
				bullets([
					"`screenshot_view` captures the page; the image is attached to your next message so you can look at it.",
					"`click_at` and `type_at` act on viewport pixel coordinates (x, y) taken from that screenshot.",
					"Prefer refs from `snapshot` when they exist; fall back to coordinates for canvas-like or unlabeled widgets.",
				]),
			].join("\n"),
		);
	}

	return sections.join("\n\n");
}
