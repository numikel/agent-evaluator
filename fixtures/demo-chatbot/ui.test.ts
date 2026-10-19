// @vitest-environment jsdom
/**
 * Drives the real `public/index.html` + `public/app.js` inside jsdom against the Hono app
 * (fetch is routed to `app.request()`), so the accessible shape the simulator relies on is
 * verified end to end without a browser binary.
 */
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoApp } from "./server.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const app = createDemoApp({ delayScale: 0 });

interface UploadLike {
	get(name: string): unknown;
}

async function toRequestInit(init: RequestInit | undefined): Promise<RequestInit | undefined> {
	const body = init?.body as unknown;
	if (!body || typeof body !== "object" || !("get" in body)) return init;
	// jsdom's FormData is not Node's: serialise the multipart body by hand.
	const file = (body as UploadLike).get("file") as File;
	const boundary = "----vitest-boundary";
	const payload =
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
		`Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n${await file.text()}\r\n--${boundary}--\r\n`;
	return {
		...init,
		headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
		body: payload,
	};
}

/**
 * undici's multipart parser builds `File` objects with the global constructor and then asserts
 * they carry its own brand. Under the jsdom environment the global `File`/`Blob` are jsdom's, so
 * on Node ≥ 24 `request.formData()` fails with an assertion. Swap in Node's classes while the
 * server handles the request (the browser-side code under test never runs inside this window).
 */
async function withNodeFileGlobals<T>(run: () => Promise<T>): Promise<T> {
	const saved = { File: globalThis.File, Blob: globalThis.Blob };
	Object.assign(globalThis, { File: NodeFile, Blob: NodeBlob });
	try {
		return await run();
	} finally {
		Object.assign(globalThis, saved);
	}
}

async function boot(mode?: string): Promise<void> {
	const html = await readFile(join(PUBLIC, "index.html"), "utf8");
	const js = await readFile(join(PUBLIC, "app.js"), "utf8");
	window.history.replaceState({}, "", mode ? `/?mode=${mode}` : "/");
	document.documentElement.innerHTML = html;
	vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) =>
		withNodeFileGlobals(async () => app.request(String(input), await toRequestInit(init))),
	);
	vm.runInThisContext(js, { filename: "app.js" });
}

const $ = <T extends Element>(selector: string): T => {
	const el = document.querySelector<T>(selector);
	if (!el) throw new Error(`missing ${selector}`);
	return el;
};

const botMessages = () => [...document.querySelectorAll<HTMLElement>('[data-role="bot"]')];
const lastBot = () => botMessages().at(-1);
const idle = () =>
	vi.waitFor(() => {
		expect($<HTMLButtonElement>("#send").disabled).toBe(false);
		expect(lastBot()?.getAttribute("aria-busy")).toBeNull();
	});

function send(text: string): void {
	const input = $<HTMLTextAreaElement>("#input");
	input.value = text;
	input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.documentElement.innerHTML = "";
});

describe("demo chatbot UI", () => {
	it("exposes the accessible chat widget and greets on load", async () => {
		await boot();
		expect($('[role="log"]').getAttribute("aria-label")).toBe("Conversation");
		expect($("textarea").getAttribute("aria-label")).toBe("Message");
		expect($('button[type="submit"]').textContent?.trim()).toBe("Send");
		expect($('input[type="file"]').getAttribute("aria-label")).toBe("Attach file");
		await idle();
		expect(botMessages()).toHaveLength(1);
		expect(lastBot()?.textContent).toMatch(/Hello/);
		expect($("#mode-badge").hasAttribute("hidden")).toBe(true);
	});

	it("Enter submits, the reply streams in and a Download button offers the PDF", async () => {
		await boot();
		await idle();
		send("customer 4471, september invoice please");
		expect($<HTMLTextAreaElement>("#input").value).toBe("");
		const user = $('[data-role="user"]');
		expect(user.textContent).toContain("customer 4471, september invoice please");
		await idle();
		const bot = lastBot();
		expect(bot?.textContent).toMatch(/September 2026/);
		const button = bot?.querySelector("button");
		expect(button?.textContent).toBe("Download");
		expect(bot?.textContent).toContain("invoice-september-2026.pdf");

		const clicks: string[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			clicks.push(`${this.getAttribute("href")} as ${this.download}`);
		});
		button?.click();
		expect(clicks).toEqual(["/api/invoice/september.pdf as invoice-september-2026.pdf"]);
	});

	it("ignores empty submissions and Shift+Enter", async () => {
		await boot();
		await idle();
		const input = $<HTMLTextAreaElement>("#input");
		input.value = "   ";
		$("#composer").dispatchEvent(new Event("submit", { cancelable: true }));
		input.value = "hello";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
		expect(document.querySelectorAll('[data-role="user"]')).toHaveLength(0);
		expect(input.value).toBe("hello");
	});

	it("noattach mode never renders a Download button and shows the mode badge", async () => {
		await boot("noattach");
		await idle();
		expect($("#mode-badge").textContent).toBe("mode: noattach");
		send("customer 4471, september invoice please");
		await idle();
		expect(lastBot()?.textContent).toMatch(/September/);
		expect(lastBot()?.querySelector("button")).toBeNull();
	});

	it("disables the message input while a reply streams so typed text is never dropped", async () => {
		await boot();
		await idle();
		send("hello");
		expect($<HTMLTextAreaElement>("#input").disabled).toBe(true);
		await idle();
		expect($<HTMLTextAreaElement>("#input").disabled).toBe(false);
		expect(document.activeElement).toBe($("#input"));
	});

	it("broken mode logs a console error and leaves the reply unfinished", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		await boot("broken");
		await vi.waitFor(() => expect(errors).toHaveBeenCalled());
		expect(String(errors.mock.calls[0]?.[0])).toMatch(/stream error/i);
		expect(lastBot()?.getAttribute("aria-busy")).toBe("true");
		expect(lastBot()?.querySelector("button")).toBeNull();
		// The composer is usable again so the user can retry.
		await vi.waitFor(() => expect($<HTMLButtonElement>("#send").disabled).toBe(false));
	});

	it("uploads the attached file and shows the bot's acknowledgement", async () => {
		await boot();
		await idle();
		const input = $<HTMLInputElement>("#attach");
		const file = new File(["hello world"], "notes.txt", { type: "text/plain" });
		Object.defineProperty(input, "files", { value: { 0: file, length: 1, item: () => file } });
		input.dispatchEvent(new Event("change"));
		await vi.waitFor(() => expect(botMessages()).toHaveLength(2));
		expect($('[data-role="user"]').textContent).toContain("Attached file: notes.txt");
		expect(lastBot()?.textContent).toMatch(/received "notes\.txt" \(11 bytes\)/);
	});
});
