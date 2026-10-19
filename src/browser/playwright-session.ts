import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Download,
	type Locator,
	type Page,
	type Request,
} from "playwright";
import type {
	BrowserSession,
	BrowserSessionFactory,
	BrowserSessionOptions,
	ConsoleMessage,
	DownloadResult,
	NetworkFailure,
	ScreenshotResult,
	ScrollDirection,
	SnapshotResult,
	WaitForReplyOptions,
	WaitForReplyResult,
} from "./types.js";

/** Last-resort Chromium location used by sandboxes that cannot download Playwright's build. */
export const FALLBACK_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10_000;
const DEFAULT_SCROLL_PX = 600;
const DEFAULT_CAPTURE_INTERVAL_MS = 1000;
const MAX_POLL_MS = 250;
const MIN_POLL_MS = 50;

/**
 * Picks the Chromium binary: explicit option → `AE_CHROMIUM_PATH` → Playwright's bundled build →
 * `/opt/pw-browsers/chromium`. Throws with install instructions when none exists.
 */
export function resolveChromiumExecutable(explicit?: string): string {
	const candidates: Array<{ path: string | undefined; mustExist: boolean }> = [
		{ path: explicit, mustExist: false },
		{ path: process.env.AE_CHROMIUM_PATH, mustExist: false },
		{ path: safeDefaultExecutable(), mustExist: true },
		{ path: FALLBACK_CHROMIUM_PATH, mustExist: true },
	];
	for (const { path, mustExist } of candidates) {
		if (!path) continue;
		if (!mustExist || existsSync(path)) return path;
	}
	throw new Error(
		"Chromium not found. Run `npx playwright install chromium` or set AE_CHROMIUM_PATH " +
			"(or BrowserSessionOptions.executablePath) to a Chromium binary.",
	);
}

function safeDefaultExecutable(): string | undefined {
	try {
		return chromium.executablePath();
	} catch {
		return undefined;
	}
}

const REF_PATTERN = /\[ref=([a-z0-9]+)\]/g;

const MIME_BY_EXTENSION: Record<string, string> = {
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".zip": "application/zip",
	".csv": "text/csv",
	".txt": "text/plain",
	".md": "text/markdown",
	".json": "application/json",
	".xml": "application/xml",
	".html": "text/html",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".doc": "application/msword",
	".xls": "application/vnd.ms-excel",
};

const MAGIC_BYTES: Array<{ bytes: number[]; mime: string }> = [
	{ bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" },
	{ bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
	{ bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
	{ bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" },
];

/** Sniffs well-known magic bytes first; zip containers keep the extension's richer type (docx/xlsx). */
export function detectMime(filename: string, head: Uint8Array): string | undefined {
	for (const { bytes, mime } of MAGIC_BYTES) {
		if (bytes.every((b, i) => head[i] === b)) return mime;
	}
	const byExtension = MIME_BY_EXTENSION[extname(filename).toLowerCase()];
	if (byExtension) return byExtension;
	const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
	return isZip ? "application/zip" : undefined;
}

/** Keeps the original name recognisable while making it safe for any filesystem. */
export function safeFilename(suggested: string): string {
	const cleaned = basename(suggested)
		.replace(/[^\w.\- ]+/g, "_")
		.trim();
	return cleaned.length > 0 && cleaned !== "." && cleaned !== ".." ? cleaned : "download";
}

async function uniquePath(dir: string, filename: string): Promise<string> {
	const ext = extname(filename);
	const stem = filename.slice(0, filename.length - ext.length);
	for (let i = 0; ; i += 1) {
		const candidate = join(dir, i === 0 ? filename : `${stem}-${i}${ext}`);
		if (!existsSync(candidate)) return candidate;
	}
}

function consoleLevel(type: string): ConsoleMessage["level"] {
	switch (type) {
		case "error":
			return "error";
		case "warning":
			return "warn";
		case "info":
			return "info";
		default:
			return "log";
	}
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PlaywrightSession implements BrowserSession {
	private knownRefs = new Set<string>();
	private imagesAtSnapshot = new Set<string>();
	private readonly consoleQueue: ConsoleMessage[] = [];
	private readonly networkQueue: NetworkFailure[] = [];
	private readonly inFlight = new Map<Request, number>();
	private closed = false;

	constructor(
		private readonly context: BrowserContext,
		private readonly page: Page,
		private readonly options: BrowserSessionOptions,
	) {
		page.on("console", (message) => {
			// Chromium mirrors every failed request as a console error; `drainNetworkFailures` covers those.
			if (message.text().startsWith("Failed to load resource")) return;
			this.consoleQueue.push({
				level: consoleLevel(message.type()),
				text: message.text(),
				at: new Date().toISOString(),
			});
		});
		page.on("pageerror", (error) => {
			this.consoleQueue.push({
				level: "error",
				text: error.message,
				at: new Date().toISOString(),
			});
		});
		page.on("request", (request) => {
			this.inFlight.set(request, Date.now());
		});
		page.on("requestfinished", (request) => {
			this.inFlight.delete(request);
		});
		page.on("requestfailed", (request) => {
			this.inFlight.delete(request);
			this.networkQueue.push({
				url: request.url(),
				status: undefined,
				error: request.failure()?.errorText ?? "request failed",
			});
		});
		page.on("response", (response) => {
			if (response.status() >= 400) {
				this.networkQueue.push({
					url: response.url(),
					status: response.status(),
					error: undefined,
				});
			}
		});
	}

	async open(url: string): Promise<void> {
		await this.page.goto(url, { waitUntil: "load" });
	}

	async snapshot(): Promise<SnapshotResult> {
		const tree = await this.ariaTree();
		this.knownRefs = new Set(Array.from(tree.matchAll(REF_PATTERN), (m) => m[1] ?? ""));
		this.imagesAtSnapshot = new Set(await this.imageSources());
		return { tree, url: this.page.url(), title: await this.page.title() };
	}

	async screenshot(): Promise<ScreenshotResult> {
		const png = await this.page.screenshot({ type: "png", scale: "css" });
		const size = this.page.viewportSize() ?? this.options.viewport;
		return { png: new Uint8Array(png), width: size.width, height: size.height };
	}

	/**
	 * Screenshot with numbered labels drawn next to every interactive element, the number being the
	 * element's ref (`e12` → `12`). Intended for vision mode (P6): the model sees the same ids in
	 * the picture and in the tree. The overlay lives in the DOM only for the duration of the capture.
	 */
	async screenshotAnnotated(): Promise<ScreenshotResult & { labels: string[] }> {
		const tree = await this.page.ariaSnapshot({ mode: "ai", boxes: true });
		const boxes = Array.from(
			tree.matchAll(
				/^\s*- (\w+)\b[^\n]*\[ref=([a-z0-9]+)\][^\n]*\[box=(\d+),(\d+),(\d+),(\d+)\]/gm,
			),
			(m) => ({
				role: m[1] ?? "",
				ref: m[2] ?? "",
				x: Number(m[3]),
				y: Number(m[4]),
				w: Number(m[5]),
				h: Number(m[6]),
			}),
		).filter((b) => INTERACTIVE_ROLES.has(b.role) && b.w > 0 && b.h > 0);
		await this.page.evaluate(renderLabels, boxes);
		try {
			const shot = await this.screenshot();
			return { ...shot, labels: boxes.map((b) => b.ref) };
		} finally {
			await this.page.evaluate(removeLabels);
		}
	}

	async click(ref: string): Promise<void> {
		await (await this.locator(ref)).click();
	}

	async type(
		ref: string,
		text: string,
		options?: { submit?: boolean; clear?: boolean },
	): Promise<void> {
		const target = await this.locator(ref);
		await this.waitUntilEditable(target, ref);
		if (options?.clear) await target.fill(text);
		else await target.pressSequentially(text);
		if (options?.submit) await target.press("Enter");
	}

	/**
	 * Keystrokes sent to a disabled or read-only field are silently dropped (Playwright's `press*`
	 * methods perform no actionability checks), and chat UIs commonly disable the composer while a
	 * reply streams. Wait, like a user would, until the field accepts input.
	 */
	private async waitUntilEditable(target: Locator, ref: string): Promise<void> {
		const handle = await target.elementHandle({ timeout: this.options.navigationTimeoutMs });
		if (!handle) return;
		try {
			await this.page.waitForFunction(
				(el) => {
					const field = el as HTMLInputElement;
					return !field.disabled && !field.readOnly && el.getAttribute("aria-disabled") !== "true";
				},
				handle,
				{ timeout: this.options.navigationTimeoutMs },
			);
		} catch (error) {
			if (error instanceof Error && /Timeout/.test(error.message)) {
				throw new Error(
					`"${ref}" stayed disabled for ${this.options.navigationTimeoutMs} ms; the page may be stuck waiting for a reply`,
				);
			}
			throw error;
		} finally {
			await handle.dispose();
		}
	}

	async press(key: string): Promise<void> {
		await this.page.keyboard.press(key);
	}

	async scroll(direction: ScrollDirection, amount = DEFAULT_SCROLL_PX): Promise<void> {
		await this.page.mouse.wheel(0, direction === "down" ? amount : -amount);
	}

	async wait(ms: number): Promise<void> {
		await this.page.waitForTimeout(ms);
	}

	async download(ref: string, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS): Promise<DownloadResult> {
		const target = await this.locator(ref);
		let download: Download;
		try {
			[download] = await Promise.all([
				this.page.waitForEvent("download", { timeout: timeoutMs }),
				target.click(),
			]);
		} catch (error) {
			if (error instanceof Error && /Timeout/.test(error.message)) {
				throw new Error(`No download started within ${timeoutMs} ms after clicking "${ref}"`);
			}
			throw error;
		}
		const filename = download.suggestedFilename();
		await mkdir(this.options.downloadDir, { recursive: true });
		const path = await uniquePath(this.options.downloadDir, safeFilename(filename));
		await download.saveAs(path);
		const [{ size }, head] = await Promise.all([stat(path), readHead(path)]);
		return { filename, path, mime: detectMime(filename, head), bytes: size };
	}

	async upload(ref: string, filePaths: string[]): Promise<void> {
		const target = await this.locator(ref);
		const [chooser] = await Promise.all([
			this.page.waitForEvent("filechooser", { timeout: DEFAULT_DOWNLOAD_TIMEOUT_MS }),
			target.click(),
		]);
		await chooser.setFiles(filePaths);
	}

	async waitForReplyStable(options: WaitForReplyOptions): Promise<WaitForReplyResult> {
		const { timeoutMs, stableMs, onInterim } = options;
		const captureIntervalMs = options.captureIntervalMs ?? DEFAULT_CAPTURE_INTERVAL_MS;
		const pollMs = Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, Math.floor(stableMs / 2)));
		const startedAt = Date.now();
		const initial = await this.ariaTree();
		let last = initial;
		let lastChangeAt = startedAt;
		let lastCaptureAt = startedAt;
		let firstChangeMs: number | undefined;
		let stable = false;

		for (;;) {
			const remaining = timeoutMs - (Date.now() - startedAt);
			if (remaining <= 0) break;
			await sleep(Math.min(pollMs, remaining));
			const tree = await this.ariaTree();
			const now = Date.now();
			if (tree !== last) {
				last = tree;
				lastChangeAt = now;
				if (firstChangeMs === undefined && tree !== initial) firstChangeMs = now - startedAt;
			}
			if (onInterim && now - lastCaptureAt >= captureIntervalMs) {
				lastCaptureAt = now;
				await onInterim(await this.screenshot(), now - startedAt);
			}
			if (now - lastChangeAt >= stableMs && this.networkIdle(now, stableMs)) {
				stable = true;
				break;
			}
		}
		const snapshot = await this.snapshot();
		return { stable, firstChangeMs, elapsedMs: Date.now() - startedAt, snapshot };
	}

	async clickAt(x: number, y: number): Promise<void> {
		await this.page.mouse.click(x, y);
	}

	async typeAt(x: number, y: number, text: string, options?: { submit?: boolean }): Promise<void> {
		await this.page.mouse.click(x, y);
		await this.page.keyboard.type(text);
		if (options?.submit) await this.page.keyboard.press("Enter");
	}

	drainConsole(): ConsoleMessage[] {
		return this.consoleQueue.splice(0);
	}

	drainNetworkFailures(): NetworkFailure[] {
		return this.networkQueue.splice(0);
	}

	async newImages(): Promise<string[]> {
		const current = await this.imageSources();
		return Array.from(new Set(current.filter((src) => !this.imagesAtSnapshot.has(src))));
	}

	async currentUrl(): Promise<string> {
		return this.page.url();
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.context.close();
	}

	private ariaTree(): Promise<string> {
		return this.page.ariaSnapshot({ mode: "ai" });
	}

	private imageSources(): Promise<string[]> {
		return this.page.evaluate(() =>
			Array.from(document.images, (img) => img.currentSrc || img.src).filter(
				(src) => src.length > 0 && !src.startsWith("data:"),
			),
		);
	}

	/**
	 * A request that has been pending for longer than `stableMs` is treated as a long-lived stream
	 * (SSE, long-poll, keep-alive) rather than as work still in progress.
	 */
	private networkIdle(now: number, stableMs: number): boolean {
		for (const startedAt of this.inFlight.values()) {
			if (now - startedAt < stableMs) return false;
		}
		return true;
	}

	/** Resolves a ref against the latest snapshot; refs the model has not seen are rejected early. */
	private async locator(ref: string): Promise<Locator> {
		if (this.knownRefs.size === 0) await this.snapshot();
		if (!this.knownRefs.has(ref)) {
			throw new Error(`Unknown ref "${ref}" — take a new snapshot`);
		}
		return this.page.getByRef(ref);
	}
}

async function readHead(path: string): Promise<Uint8Array> {
	const buffer = await readFile(path);
	return new Uint8Array(buffer.subarray(0, 8));
}

const INTERACTIVE_ROLES = new Set([
	"button",
	"link",
	"textbox",
	"searchbox",
	"combobox",
	"checkbox",
	"radio",
	"switch",
	"slider",
	"spinbutton",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"tab",
	"listbox",
]);

type LabelBox = { ref: string; x: number; y: number; w: number; h: number };

/** Runs in the page: draws one numbered badge per box. Kept dependency-free and side-effect-scoped. */
function renderLabels(boxes: LabelBox[]): void {
	const existing = document.getElementById("__ae_labels__");
	existing?.remove();
	const layer = document.createElement("div");
	layer.id = "__ae_labels__";
	layer.style.cssText =
		"position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:bold 11px/1 monospace;";
	for (const box of boxes) {
		const badge = document.createElement("div");
		badge.textContent = box.ref.replace(/^e/, "");
		badge.style.cssText =
			`position:absolute;left:${box.x}px;top:${Math.max(0, box.y - 12)}px;` +
			"background:#d7263d;color:#fff;padding:1px 3px;border-radius:2px;";
		const outline = document.createElement("div");
		outline.style.cssText =
			`position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;` +
			"outline:2px solid #d7263d;";
		layer.append(outline, badge);
	}
	document.body.appendChild(layer);
}

function removeLabels(): void {
	document.getElementById("__ae_labels__")?.remove();
}

/** Launches Chromium lazily (one browser per headless/slowMo combination) and opens one context per session. */
export class PlaywrightSessionFactory implements BrowserSessionFactory {
	private readonly browsers = new Map<string, Promise<Browser>>();

	async create(options: BrowserSessionOptions): Promise<PlaywrightSession> {
		const browser = await this.browserFor(options);
		const context = await browser.newContext({
			acceptDownloads: true,
			viewport: options.viewport,
			...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
		});
		context.setDefaultNavigationTimeout(options.navigationTimeoutMs);
		const page = await context.newPage();
		return new PlaywrightSession(context, page, options);
	}

	/** Closes every browser this factory launched (and with them all open sessions). */
	async close(): Promise<void> {
		const pending = Array.from(this.browsers.values());
		this.browsers.clear();
		await Promise.all(pending.map((p) => p.then((b) => b.close())));
	}

	private browserFor(options: BrowserSessionOptions): Promise<Browser> {
		const executablePath = resolveChromiumExecutable(options.executablePath);
		const key = `${executablePath}|${options.headless}|${options.slowMoMs ?? 0}`;
		let browser = this.browsers.get(key);
		if (!browser) {
			browser = chromium.launch({
				headless: options.headless,
				executablePath,
				...(options.slowMoMs ? { slowMo: options.slowMoMs } : {}),
			});
			this.browsers.set(key, browser);
		}
		return browser;
	}
}
