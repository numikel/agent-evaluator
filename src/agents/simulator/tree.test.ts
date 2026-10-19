import { describe, expect, it } from "vitest";
import { extractBotReply, findMessageTextbox, treeToText } from "./tree.js";

const chrome = '- textbox "Message" [ref=e1]\n- button "Send" [ref=e2]';

describe("findMessageTextbox", () => {
	it("prefers a textbox whose name looks like a chat input", () => {
		const tree = [
			'- textbox "Search" [ref=e3]',
			'- textbox "Type your message" [ref=e7]',
			'- button "Send" [ref=e8]',
		].join("\n");
		expect(findMessageTextbox(tree)).toBe("e7");
	});

	it("falls back to the only textbox", () => {
		expect(findMessageTextbox('- textbox "Query" [ref=e4]\n- button "Go" [ref=e5]')).toBe("e4");
	});

	it("returns undefined when there is no textbox or the choice is ambiguous", () => {
		expect(findMessageTextbox('- button "Go" [ref=e5]')).toBeUndefined();
		expect(findMessageTextbox('- textbox "A" [ref=e1]\n- textbox "B" [ref=e2]')).toBeUndefined();
	});
});

describe("extractBotReply", () => {
	it("extracts the new paragraphs after the user's message (list of paragraphs)", () => {
		const before = ["- paragraph: Welcome!", chrome].join("\n");
		const after = [
			"- paragraph: Welcome!",
			"- paragraph: need my invoice",
			"- paragraph: Sure, which month?",
			"- paragraph: I can email it or you can download it.",
			chrome,
		].join("\n");
		expect(extractBotReply({ before, after, userText: "need my invoice" })).toBe(
			"Sure, which month?\nI can email it or you can download it.",
		);
	});

	it("extracts the new entries inside a log role container", () => {
		const before = ['- log "Conversation" [ref=e9]:', "  - text: Hi there", chrome].join("\n");
		const after = [
			'- log "Conversation" [ref=e9]:',
			"  - text: Hi there",
			"  - text: need my invoice",
			'  - text: "Here it is: invoice-09.pdf"',
			'  - link "Download" [ref=e12]',
			chrome,
		].join("\n");
		expect(extractBotReply({ before, after, userText: "need my invoice" })).toBe(
			"Here it is: invoice-09.pdf\n[link] Download",
		);
	});

	it("extracts text from nested generic containers", () => {
		const before = [
			"- generic [ref=e3]:",
			"  - generic [ref=e4]:",
			"    - text: Hello",
			chrome,
		].join("\n");
		const after = [
			"- generic [ref=e3]:",
			"  - generic [ref=e4]:",
			"    - text: Hello",
			"  - generic [ref=e5]:",
			"    - generic [ref=e6]: need my invoice",
			"  - generic [ref=e7]:",
			"    - generic [ref=e8]:",
			'      - heading "Invoice ready" [level=3]',
			"      - text: Click the button below.",
			'      - button "Download PDF" [ref=e9]',
			chrome,
		].join("\n");
		expect(extractBotReply({ before, after, userText: "need my invoice" })).toBe(
			"Invoice ready\nClick the button below.\n[button] Download PDF",
		);
	});

	it("falls back to all new text nodes when the user's message is not echoed", () => {
		const before = chrome;
		const after = ["- paragraph: Thanks, one moment.", chrome].join("\n");
		expect(extractBotReply({ before, after, userText: "hello" })).toBe("Thanks, one moment.");
	});

	it("returns an empty string when nothing changed", () => {
		expect(extractBotReply({ before: chrome, after: chrome, userText: "hello" })).toBe("");
	});
});

describe("treeToText", () => {
	it("renders readable text with control labels", () => {
		const tree = ['- heading "Support" [level=1]', "- paragraph: Hello", chrome].join("\n");
		expect(treeToText(tree)).toBe("Support\nHello\n[textbox] Message\n[button] Send");
	});
});
