import { describe, expect, it } from "vitest";
import { createDemoApp, startDemo } from "./server.js";

interface SseEvent {
	event: string;
	data: string;
}

function parseSse(text: string): SseEvent[] {
	return text
		.split("\n\n")
		.map((block) => block.trim())
		.filter((block) => block.length > 0 && !block.startsWith(":"))
		.map((block) => {
			const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
			const data = [...block.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).join("\n");
			return { event, data };
		});
}

/** Read SSE events from a response until `until` matches one of them, then cancel the stream. */
async function readEvents(res: Response, until: (e: SseEvent) => boolean): Promise<SseEvent[]> {
	const reader = res.body?.getReader();
	if (!reader) throw new Error("no body");
	const decoder = new TextDecoder();
	let buffer = "";
	let events: SseEvent[] = [];
	while (!events.some(until)) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		events = parseSse(buffer.slice(0, buffer.lastIndexOf("\n\n") + 2));
	}
	await reader.cancel();
	return events;
}

const app = createDemoApp({ delayScale: 0 });

async function chat(messages: unknown[], mode?: string): Promise<Response> {
	const url = mode ? `/api/chat?mode=${mode}` : "/api/chat";
	return app.request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ messages }),
	});
}

describe("demo chatbot — static pages", () => {
	it("serves the chat page with the accessible chat widget", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/text\/html/);
		const html = await res.text();
		expect(html).toContain('role="log"');
		expect(html).toContain('aria-label="Message"');
		expect(html).toContain('aria-label="Attach file"');
		expect(html).toMatch(/<button[^>]*type="submit"[^>]*>\s*Send\s*<\/button>/);
		expect(html).toContain('data-testid="input"');
		expect(html).toContain('data-testid="send"');
		expect(html).toContain('data-testid="messages"');
	});

	it("serves the script and the stylesheet with proper content types", async () => {
		const js = await app.request("/app.js");
		expect(js.status).toBe(200);
		expect(js.headers.get("content-type")).toMatch(/javascript/);
		const css = await app.request("/style.css");
		expect(css.status).toBe(200);
		expect(css.headers.get("content-type")).toMatch(/text\/css/);
	});

	it("returns 404 for unknown static files", async () => {
		const res = await app.request("/nope.js");
		expect(res.status).toBe(404);
	});
});

describe("demo chatbot — /api/invoice", () => {
	it("generates a downloadable PDF of at least 500 bytes with the invoice title", async () => {
		const res = await app.request("/api/invoice/september.pdf");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-disposition")).toMatch(
			/attachment; filename="invoice-september-2026\.pdf"/,
		);
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(bytes.byteLength).toBeGreaterThanOrEqual(500);
		const text = new TextDecoder("latin1").decode(bytes);
		expect(text.startsWith("%PDF-")).toBe(true);
		expect(text).toContain("Invoice September 2026");
	});

	it("rejects unknown months", async () => {
		const res = await app.request("/api/invoice/smarch.pdf");
		expect(res.status).toBe(404);
	});
});

describe("demo chatbot — /api/chat", () => {
	it("streams the reply token by token over SSE and ends with a done event", async () => {
		const res = await chat([{ role: "user", text: "customer 4471, september invoice please" }]);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
		const events = parseSse(await res.text());
		const tokens = events.filter((e) => e.event === "token");
		expect(tokens.length).toBeGreaterThan(3);
		const streamed = tokens.map((e) => JSON.parse(e.data).text).join("");
		const done = events.at(-1);
		expect(done?.event).toBe("done");
		const payload = JSON.parse(done?.data ?? "{}");
		expect(payload.text).toBe(streamed);
		expect(payload.text).toMatch(/September 2026/);
		expect(payload.attachment).toEqual({
			name: "invoice-september-2026.pdf",
			url: "/api/invoice/september.pdf",
			mime: "application/pdf",
		});
	});

	it("greets when the history is empty", async () => {
		const res = await chat([]);
		const events = parseSse(await res.text());
		const done = JSON.parse(events.at(-1)?.data ?? "{}");
		expect(done.text).toMatch(/hello/i);
		expect(done.attachment).toBeNull();
	});

	it("honours ?mode= (noattach never attaches)", async () => {
		const res = await chat(
			[{ role: "user", text: "customer 4471, september invoice please" }],
			"noattach",
		);
		const done = JSON.parse(parseSse(await res.text()).at(-1)?.data ?? "{}");
		expect(done.text).toMatch(/September/);
		expect(done.attachment).toBeNull();
	});

	it("accepts the mode in the JSON body too", async () => {
		const res = await app.request("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [], mode: "offtopic" }),
		});
		const done = JSON.parse(parseSse(await res.text()).at(-1)?.data ?? "{}");
		expect(done.text).toMatch(/newsletter/i);
	});

	it("broken mode emits an error event and never sends done", async () => {
		const res = await chat(
			[{ role: "user", text: "customer 4471, september invoice please" }],
			"broken",
		);
		const events = await readEvents(res, (e) => e.event === "error" || e.event === "done");
		expect(events.some((e) => e.event === "token")).toBe(true);
		expect(events.some((e) => e.event === "error")).toBe(true);
		expect(events.some((e) => e.event === "done")).toBe(false);
	});

	it("rejects malformed bodies", async () => {
		const res = await app.request("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect(res.status).toBe(400);
		const bad = await app.request("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: "nope" }),
		});
		expect(bad.status).toBe(400);
	});
});

describe("demo chatbot — /api/upload and /api/reset", () => {
	it("echoes the uploaded file name and size", async () => {
		const form = new FormData();
		form.append("file", new File(["hello world"], "notes.txt", { type: "text/plain" }));
		const res = await app.request("/api/upload", { method: "POST", body: form });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			name: "notes.txt",
			size: 11,
			message: expect.stringContaining("notes.txt"),
		});
	});

	it("rejects uploads without a file", async () => {
		const form = new FormData();
		form.append("note", "nothing here");
		const res = await app.request("/api/upload", { method: "POST", body: form });
		expect(res.status).toBe(400);
	});

	it("reset clears the server-side upload list", async () => {
		const local = createDemoApp({ delayScale: 0 });
		const form = new FormData();
		form.append("file", new File(["x"], "a.txt"));
		await local.request("/api/upload", { method: "POST", body: form });
		const before = await (await local.request("/api/state")).json();
		expect(before.uploads).toEqual(["a.txt"]);
		const reset = await local.request("/api/reset");
		expect(reset.status).toBe(200);
		expect(await reset.json()).toEqual({ ok: true });
		const after = await (await local.request("/api/state")).json();
		expect(after.uploads).toEqual([]);
	});
});

describe("startDemo()", () => {
	it("listens on a real port and serves the chat page", async () => {
		const demo = await startDemo(0, { delayScale: 0 });
		try {
			expect(demo.port).toBeGreaterThan(0);
			expect(demo.url).toBe(`http://localhost:${demo.port}`);
			const res = await fetch(`${demo.url}/`);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('aria-label="Message"');
			const pdf = await fetch(`${demo.url}/api/invoice/september.pdf`);
			expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThanOrEqual(500);
		} finally {
			await demo.close();
		}
	});
});
