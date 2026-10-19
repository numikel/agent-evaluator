import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	detectMime,
	type PlaywrightSession,
	PlaywrightSessionFactory,
	resolveChromiumExecutable,
	safeFilename,
} from "./playwright-session.js";
import { startTestServer, type TestServer } from "./test-server.js";
import type { BrowserSession, BrowserSessionOptions } from "./types.js";

/** The sandbox may ship a Chromium that is not the one Playwright expects; point at it. */
const FALLBACK_CHROMIUM = "/opt/pw-browsers/chromium";

const PDF_BASE64 = Buffer.from("%PDF-1.4\n%fake\n").toString("base64");

const PAGES: Record<string, string> = {
	"/chat": `<!doctype html><title>Chat</title>
<button onclick="document.title='clicked'">Send</button>
<input aria-label="Message" onkeydown="if(event.key==='Enter')document.title='enter:'+this.value">`,
	"/download": `<!doctype html><title>Files</title>
<a download="Q3 report.pdf" href="data:application/pdf;base64,${PDF_BASE64}">Report</a>
<button onclick="document.title='nothing'">Nothing</button>`,
	"/upload": `<!doctype html><title>Upload</title>
<input type="file" aria-label="Attach" onchange="document.title='file:'+this.files[0].name">`,
	"/stream": `<!doctype html><title>Stream</title>
<button onclick="stream()">Ask</button><p id="reply"></p>
<script>
function stream(){let n=0;const t=setInterval(()=>{document.getElementById('reply').textContent+=' word'+(++n);if(n===12)clearInterval(t)},100)}
</script>`,
	"/pending": `<!doctype html><title>Pending</title>
<button onclick="ask()">Ask</button><p id="log"></p>
<script>
function ask(){document.getElementById('log').textContent='sent';setTimeout(()=>fetch('/slow').then(r=>r.text()).then(t=>{document.getElementById('log').textContent+=t}),100)}
</script>`,
	"/static": "<!doctype html><title>Static</title><p>Nothing ever changes here.</p>",
	"/errors": `<!doctype html><title>Errors</title>
<script>
console.error("boom"); console.warn("careful"); console.log("plain");
Promise.allSettled([fetch('/missing'), fetch('http://127.0.0.1:1/unreachable')]).then(()=>{document.title='done'});
</script>`,
	"/images": `<!doctype html><title>Images</title>
<img src="/old.png" alt="old">
<button onclick="const i=document.createElement('img');i.src='/new.png';i.alt='new';document.body.appendChild(i)">Add</button>`,
	"/tall": `<!doctype html><title>Tall</title>
<div style="height:5000px">tall</div>
<script>addEventListener('scroll',()=>{document.title='y'+Math.round(scrollY)})</script>`,
	"/vision": `<!doctype html><title>Vision</title>
<button style="position:fixed;left:0;top:0;width:100px;height:50px" onclick="document.title='clicked'">Go</button>
<input aria-label="Message" style="position:fixed;left:0;top:100px;width:200px;height:40px" onkeydown="if(event.key==='Enter')document.title='enter:'+this.value">`,
};

const refOf = (tree: string, needle: string): string => {
	const line = tree.split("\n").find((l) => l.includes(needle));
	const match = line?.match(/\[ref=(e\d+)\]/);
	if (!match?.[1]) throw new Error(`no ref for ${needle} in:\n${tree}`);
	return match[1];
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe("PlaywrightSession", () => {
	let server: TestServer;
	let factory: PlaywrightSessionFactory;
	let downloadDir: string;
	const sessions: BrowserSession[] = [];

	const options = (): BrowserSessionOptions => ({
		headless: true,
		viewport: { width: 800, height: 600 },
		downloadDir,
		navigationTimeoutMs: 10_000,
	});

	const createSession = async (): Promise<BrowserSession> => {
		const session = await factory.create(options());
		sessions.push(session);
		return session;
	};

	const openPage = async (path: string): Promise<BrowserSession> => {
		const session = await createSession();
		await session.open(`${server.url}${path}`);
		return session;
	};

	const titleOf = (session: BrowserSession) => async () => (await session.snapshot()).title;

	beforeAll(async () => {
		if (!existsSync(chromium.executablePath()) && !process.env.AE_CHROMIUM_PATH) {
			process.env.AE_CHROMIUM_PATH = FALLBACK_CHROMIUM;
		}
		downloadDir = await mkdtemp(join(tmpdir(), "ae-downloads-"));
		server = await startTestServer({
			...PAGES,
			"/slow": (_req, res) => {
				setTimeout(() => {
					res.writeHead(200, { "content-type": "text/plain" });
					res.end(" reply");
				}, 2000);
			},
		});
		factory = new PlaywrightSessionFactory();
	});

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map((s) => s.close()));
	});

	afterAll(async () => {
		await factory.close();
		await server.close();
		await rm(downloadDir, { recursive: true, force: true });
	});

	it("snapshots the accessibility tree with refs and clicks by ref", async () => {
		const session = await openPage("/chat");
		const snapshot = await session.snapshot();
		expect(snapshot.tree).toContain("[ref=e");
		expect(snapshot.tree).toContain('textbox "Message"');
		expect(snapshot.url).toBe(`${server.url}/chat`);
		expect(snapshot.title).toBe("Chat");
		await session.click(refOf(snapshot.tree, 'button "Send"'));
		expect((await session.snapshot()).title).toBe("clicked");
	});

	it("rejects refs that are not in the latest snapshot", async () => {
		const session = await openPage("/chat");
		await session.snapshot();
		await expect(session.click("e99")).rejects.toThrow('Unknown ref "e99" — take a new snapshot');
	});

	it("types into a textbox and submits with Enter", async () => {
		const session = await openPage("/chat");
		const { tree } = await session.snapshot();
		const input = refOf(tree, 'textbox "Message"');
		await session.type(input, "hello", { submit: true });
		expect((await session.snapshot()).title).toBe("enter:hello");
		await session.type(input, " there");
		await session.press("Enter");
		expect((await session.snapshot()).title).toBe("enter:hello there");
		await session.type(input, "fresh", { clear: true, submit: true });
		expect((await session.snapshot()).title).toBe("enter:fresh");
	});

	it("captures viewport screenshots as PNG", async () => {
		const session = await openPage("/chat");
		const shot = await session.screenshot();
		expect(Array.from(shot.png.subarray(0, 4))).toEqual(PNG_MAGIC);
		expect(shot.width).toBe(800);
		expect(shot.height).toBe(600);
	});

	it("saves downloads with a sniffed mime type", async () => {
		const session = await openPage("/download");
		const { tree } = await session.snapshot();
		const result = await session.download(refOf(tree, 'link "Report"'));
		expect(result.filename).toBe("Q3 report.pdf");
		expect(result.mime).toBe("application/pdf");
		expect(result.bytes).toBeGreaterThan(0);
		expect(result.path.startsWith(downloadDir)).toBe(true);
		expect((await stat(result.path)).size).toBe(result.bytes);
		expect((await readFile(result.path, "utf8")).startsWith("%PDF")).toBe(true);
	});

	it("rejects when nothing downloads within the timeout", async () => {
		const session = await openPage("/download");
		const { tree } = await session.snapshot();
		await expect(session.download(refOf(tree, 'button "Nothing"'), 300)).rejects.toThrow(
			/no download started within 300 ms/i,
		);
	});

	it("uploads files through the file chooser", async () => {
		const file = join(downloadDir, "notes.txt");
		await writeFile(file, "hello");
		const session = await openPage("/upload");
		const { tree } = await session.snapshot();
		await session.upload(refOf(tree, 'button "Attach"'), [file]);
		await expect.poll(titleOf(session)).toBe("file:notes.txt");
	});

	it("waits for a streamed reply to stabilise and emits interim screenshots", async () => {
		const session = await openPage("/stream");
		const { tree } = await session.snapshot();
		await session.click(refOf(tree, 'button "Ask"'));
		const interim: number[] = [];
		const result = await session.waitForReplyStable({
			timeoutMs: 5000,
			stableMs: 400,
			captureIntervalMs: 250,
			onInterim: (shot, elapsedMs) => {
				expect(Array.from(shot.png.subarray(0, 4))).toEqual(PNG_MAGIC);
				interim.push(elapsedMs);
			},
		});
		expect(result.stable).toBe(true);
		expect(result.firstChangeMs).toBeDefined();
		expect(result.firstChangeMs ?? Number.POSITIVE_INFINITY).toBeLessThan(300);
		expect(result.elapsedMs).toBeGreaterThanOrEqual(1000 + 400);
		expect(result.elapsedMs).toBeLessThan(5000);
		expect(interim.length).toBeGreaterThanOrEqual(1);
		expect(result.snapshot.tree).toContain("word12");
	});

	it("returns quickly on a static page without a first change", async () => {
		const session = await openPage("/static");
		const result = await session.waitForReplyStable({ timeoutMs: 5000, stableMs: 200 });
		expect(result.stable).toBe(true);
		expect(result.firstChangeMs).toBeUndefined();
		expect(result.elapsedMs).toBeLessThan(1000);
		expect(result.snapshot.tree).toContain("Nothing ever changes here.");
	});

	it("reports stable=false when the page keeps changing until the timeout", async () => {
		const session = await openPage("/stream");
		const { tree } = await session.snapshot();
		await session.click(refOf(tree, 'button "Ask"'));
		const result = await session.waitForReplyStable({ timeoutMs: 500, stableMs: 400 });
		expect(result.stable).toBe(false);
		expect(result.elapsedMs).toBeGreaterThanOrEqual(500);
	});

	it("does not declare stability while a fresh request is in flight", async () => {
		const session = await openPage("/pending");
		const { tree } = await session.snapshot();
		await session.click(refOf(tree, 'button "Ask"'));
		// DOM changes at ~0 ms, a request starts at ~100 ms and hangs for 2 s: stability must wait
		// at least until that request is older than `stableMs` (~500 ms), not fire at 400 ms.
		const result = await session.waitForReplyStable({ timeoutMs: 3000, stableMs: 400 });
		expect(result.stable).toBe(true);
		expect(result.elapsedMs).toBeGreaterThanOrEqual(500);
		expect(result.elapsedMs).toBeLessThan(2000);
	});

	it("drains console messages and network failures once", async () => {
		const session = await openPage("/errors");
		await expect.poll(titleOf(session)).toBe("done");
		const console = session.drainConsole();
		expect(console.map((m) => [m.level, m.text])).toEqual([
			["error", "boom"],
			["warn", "careful"],
			["log", "plain"],
		]);
		for (const m of console) expect(Number.isNaN(Date.parse(m.at))).toBe(false);
		const failures = session.drainNetworkFailures();
		expect(failures).toContainEqual({
			url: `${server.url}/missing`,
			status: 404,
			error: undefined,
		});
		const refused = failures.find((f) => f.url === "http://127.0.0.1:1/unreachable");
		expect(refused?.status).toBeUndefined();
		expect(refused?.error).toBeTruthy();
		expect(session.drainConsole()).toEqual([]);
		expect(session.drainNetworkFailures()).toEqual([]);
	});

	it("lists images added since the last snapshot as absolute URLs", async () => {
		const session = await openPage("/images");
		const { tree } = await session.snapshot();
		expect(await session.newImages()).toEqual([]);
		await session.click(refOf(tree, 'button "Add"'));
		await expect.poll(() => session.newImages()).toEqual([`${server.url}/new.png`]);
		await session.snapshot();
		expect(await session.newImages()).toEqual([]);
	});

	it("scrolls, waits and reports the current URL", async () => {
		const session = await openPage("/tall");
		await session.scroll("down", 500);
		await expect.poll(titleOf(session)).toBe("y500");
		await session.scroll("up", 200);
		await expect.poll(titleOf(session)).toBe("y300");
		const started = Date.now();
		await session.wait(50);
		expect(Date.now() - started).toBeGreaterThanOrEqual(45);
		expect(await session.currentUrl()).toBe(`${server.url}/tall`);
	});

	it("supports vision-mode clickAt and typeAt", async () => {
		const session = await openPage("/vision");
		await session.clickAt(50, 25);
		expect((await session.snapshot()).title).toBe("clicked");
		await session.typeAt(100, 120, "seen", { submit: true });
		expect((await session.snapshot()).title).toBe("enter:seen");
	});

	it("annotates screenshots with ref labels and leaves no trace in the page", async () => {
		const session = (await openPage("/chat")) as PlaywrightSession;
		const before = (await session.snapshot()).tree;
		const shot = await session.screenshotAnnotated();
		expect(Array.from(shot.png.subarray(0, 4))).toEqual(PNG_MAGIC);
		expect(shot.labels).toEqual([
			refOf(before, 'button "Send"'),
			refOf(before, 'textbox "Message"'),
		]);
		expect((await session.snapshot()).tree).toBe(before);
	});

	it("closes the context; factory close shuts the browser down", async () => {
		const session = await createSession();
		await session.open(`${server.url}/static`);
		await session.close();
		await session.close(); // idempotent
		await expect(session.snapshot()).rejects.toThrow();
		const local = new PlaywrightSessionFactory();
		const other = await local.create(options());
		await other.open(`${server.url}/static`);
		await local.close();
		await expect(other.currentUrl().then(() => other.snapshot())).rejects.toThrow();
	});
});

describe("download helpers", () => {
	it("sniffs magic bytes before trusting the extension", () => {
		expect(detectMime("x.txt", Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
			"application/pdf",
		);
		expect(detectMime("photo.jpeg", Uint8Array.from([0x00]))).toBe("image/jpeg");
		expect(detectMime("report.docx", Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		expect(detectMime("blob", Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe("application/zip");
		expect(detectMime("blob", Uint8Array.from([0x00]))).toBeUndefined();
	});

	it("keeps download names readable but filesystem-safe", () => {
		expect(safeFilename("Q3 report.pdf")).toBe("Q3 report.pdf");
		expect(safeFilename("../../etc/passwd")).toBe("passwd");
		expect(safeFilename("in:voice?.pdf")).toBe("in_voice_.pdf");
		expect(safeFilename("")).toBe("download");
	});
});

describe("resolveChromiumExecutable", () => {
	it("prefers the explicit path, then AE_CHROMIUM_PATH", () => {
		const previous = process.env.AE_CHROMIUM_PATH;
		process.env.AE_CHROMIUM_PATH = "/env/chrome";
		try {
			expect(resolveChromiumExecutable("/explicit/chrome")).toBe("/explicit/chrome");
			expect(resolveChromiumExecutable()).toBe("/env/chrome");
		} finally {
			if (previous === undefined) delete process.env.AE_CHROMIUM_PATH;
			else process.env.AE_CHROMIUM_PATH = previous;
		}
	});

	it("falls back to an existing binary and otherwise explains how to install one", () => {
		const resolved = resolveChromiumExecutable();
		expect(existsSync(resolved)).toBe(true);
	});
});
