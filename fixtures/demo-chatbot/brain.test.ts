import { describe, expect, it } from "vitest";
import { type DemoMessage, reply } from "./brain.js";

const user = (text: string): DemoMessage => ({ role: "user", text });
const bot = (text: string): DemoMessage => ({ role: "bot", text });

describe("reply() — normal mode", () => {
	it("greets on an empty history and asks what the user needs", () => {
		const r = reply([], "normal");
		expect(r.text).toMatch(/hello|hi|welcome/i);
		expect(r.text).toMatch(/help/i);
		expect(r.attachment).toBeUndefined();
		expect(r.delayMs).toBe(0);
		expect(r.streamForever).toBe(false);
	});

	it("greets back when the user just says hi", () => {
		const r = reply([user("hi there")], "normal");
		expect(r.text).toMatch(/hello|hi/i);
		expect(r.attachment).toBeUndefined();
	});

	it("asks for the customer number when an invoice is requested without one", () => {
		const r = reply([user("need my invoice for september as pdf")], "normal");
		expect(r.text).toMatch(/customer number/i);
		expect(r.attachment).toBeUndefined();
	});

	it("asks for the month when the customer number is known but the month is not", () => {
		const r = reply([user("customer 4471, I need an invoice")], "normal");
		expect(r.text).toMatch(/which month/i);
		expect(r.attachment).toBeUndefined();
	});

	it("attaches the PDF and confirms the month when number and month are present", () => {
		const r = reply([user("customer 4471, septmber invoice please")], "normal");
		expect(r.text).toMatch(/september/i);
		expect(r.text).toMatch(/4471/);
		expect(r.attachment).toEqual({
			name: "invoice-september-2026.pdf",
			url: "/api/invoice/september.pdf",
			mime: "application/pdf",
		});
	});

	it("remembers the customer number and month from earlier turns", () => {
		const history = [
			user("need my invoice for september as pdf"),
			bot("Sure. Could you give me your customer number?"),
			user("4471"),
		];
		const r = reply(history, "normal");
		expect(r.attachment?.url).toBe("/api/invoice/september.pdf");
		expect(r.text).toMatch(/september/i);
	});

	it("does not mistake a year for a customer number", () => {
		const r = reply([user("invoice for september 2026 please")], "normal");
		expect(r.text).toMatch(/customer number/i);
		expect(r.attachment).toBeUndefined();
	});

	it("re-attaches the file on a download follow-up", () => {
		const history = [
			user("customer 4471, september invoice please"),
			bot("Here is your invoice for September 2026."),
			user("can i download it as a file?"),
		];
		const r = reply(history, "normal");
		expect(r.attachment?.url).toBe("/api/invoice/september.pdf");
	});

	it("handles other months", () => {
		const r = reply([user("account 12345 — send me the march invoice")], "normal");
		expect(r.attachment?.url).toBe("/api/invoice/march.pdf");
		expect(r.text).toMatch(/march/i);
	});

	it("thanks back politely", () => {
		const r = reply([user("thanks!")], "normal");
		expect(r.text).toMatch(/welcome/i);
		expect(r.attachment).toBeUndefined();
	});

	it("falls back politely on unknown requests without inventing data", () => {
		const r = reply([user("what is the weather on mars?")], "normal");
		expect(r.text).toMatch(/sorry|afraid/i);
		expect(r.text).toMatch(/invoice/i);
		expect(r.attachment).toBeUndefined();
	});
});

describe("reply() — failure modes", () => {
	const fulfilled = [user("customer 4471, september invoice please")];

	it("slow: same answer, delayed by 3 s, still streams", () => {
		const r = reply(fulfilled, "slow");
		expect(r.delayMs).toBe(3000);
		expect(r.streamForever).toBe(false);
		expect(r.attachment?.url).toBe("/api/invoice/september.pdf");
	});

	it("offtopic: pushes a newsletter before answering, then still answers", () => {
		const normal = reply(fulfilled, "normal");
		const r = reply(fulfilled, "offtopic");
		expect(r.text).toMatch(/newsletter/i);
		expect(r.text.toLowerCase().indexOf("newsletter")).toBeLessThan(
			r.text.toLowerCase().indexOf("september"),
		);
		expect(r.text).toContain(normal.text);
		expect(r.attachment?.url).toBe("/api/invoice/september.pdf");
	});

	it("offtopic: also prefixes the greeting", () => {
		const r = reply([], "offtopic");
		expect(r.text).toMatch(/newsletter/i);
	});

	it("broken: marks the reply as never finishing", () => {
		const r = reply(fulfilled, "broken");
		expect(r.streamForever).toBe(true);
		expect(r.text.length).toBeGreaterThan(0);
	});

	it("noattach: describes the invoice but never attaches a file", () => {
		const r = reply(fulfilled, "noattach");
		expect(r.text).toMatch(/september/i);
		expect(r.attachment).toBeUndefined();
		expect(r.streamForever).toBe(false);
	});

	it("noattach: still asks for the customer number when missing", () => {
		const r = reply([user("need my invoice for september")], "noattach");
		expect(r.text).toMatch(/customer number/i);
	});
});
