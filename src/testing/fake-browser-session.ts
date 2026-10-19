import type {
	BrowserSession,
	ConsoleMessage,
	DownloadResult,
	NetworkFailure,
	ScreenshotResult,
	ScrollDirection,
	SnapshotResult,
	WaitForReplyOptions,
	WaitForReplyResult,
} from "../browser/types.js";

/** Minimal valid 1x1 PNG so tests can write real files. */
export const TINY_PNG = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		"base64",
	),
);

export type FakeBrowserCall = { method: string; args: unknown[] };

export type FakeBrowserSessionOptions = {
	/** Snapshots returned in order by `snapshot()` / `waitForReplyStable()`; last one repeats. */
	snapshots?: string[];
	/** Reply text appended to the next snapshot after `type(..., {submit:true})` or `press("Enter")`. */
	replies?: string[];
	downloads?: DownloadResult[];
	url?: string;
	title?: string;
};

/**
 * In-memory stand-in for `PlaywrightSession`. Records every call so simulator tests can assert on
 * the exact sequence of browser actions without launching Chromium.
 */
export class FakeBrowserSession implements BrowserSession {
	readonly calls: FakeBrowserCall[] = [];
	readonly consoleQueue: ConsoleMessage[] = [];
	readonly networkQueue: NetworkFailure[] = [];
	readonly imagesQueue: string[] = [];
	private snapshotIndex = 0;
	private replyIndex = 0;
	private downloadIndex = 0;
	private readonly snapshots: string[];
	private readonly replies: string[];
	private readonly downloads: DownloadResult[];
	private url: string;
	private readonly title: string;
	private pendingReply: string | undefined;
	closed = false;

	constructor(options: FakeBrowserSessionOptions = {}) {
		this.snapshots = options.snapshots ?? [
			'- textbox "Message" [ref=e1]\n- button "Send" [ref=e2]',
		];
		this.replies = options.replies ?? [];
		this.downloads = options.downloads ?? [];
		this.url = options.url ?? "http://localhost/";
		this.title = options.title ?? "Fake chatbot";
	}

	private record(method: string, ...args: unknown[]): void {
		this.calls.push({ method, args });
	}

	private currentTree(): string {
		const tree = this.snapshots[Math.min(this.snapshotIndex, this.snapshots.length - 1)] ?? "";
		return this.pendingReply ? `${tree}\n- paragraph: ${this.pendingReply}` : tree;
	}

	async open(url: string): Promise<void> {
		this.record("open", url);
		this.url = url;
	}

	async snapshot(): Promise<SnapshotResult> {
		this.record("snapshot");
		const result = { tree: this.currentTree(), url: this.url, title: this.title };
		if (this.snapshotIndex < this.snapshots.length - 1) this.snapshotIndex += 1;
		return result;
	}

	async screenshot(): Promise<ScreenshotResult> {
		this.record("screenshot");
		return { png: TINY_PNG, width: 1, height: 1 };
	}

	async click(ref: string): Promise<void> {
		this.record("click", ref);
	}

	async type(
		ref: string,
		text: string,
		options?: { submit?: boolean; clear?: boolean },
	): Promise<void> {
		this.record("type", ref, text, options);
		if (options?.submit) this.queueReply();
	}

	async press(key: string): Promise<void> {
		this.record("press", key);
		if (key === "Enter") this.queueReply();
	}

	private queueReply(): void {
		const reply = this.replies[this.replyIndex];
		if (reply !== undefined) {
			this.pendingReply = reply;
			this.replyIndex += 1;
		}
	}

	async scroll(direction: ScrollDirection, amount?: number): Promise<void> {
		this.record("scroll", direction, amount);
	}

	async wait(ms: number): Promise<void> {
		this.record("wait", ms);
	}

	async download(ref: string, timeoutMs?: number): Promise<DownloadResult> {
		this.record("download", ref, timeoutMs);
		const next = this.downloads[this.downloadIndex];
		if (!next) throw new Error(`FakeBrowserSession: no scripted download for ${ref}`);
		this.downloadIndex += 1;
		return next;
	}

	async upload(ref: string, filePaths: string[]): Promise<void> {
		this.record("upload", ref, filePaths);
	}

	async waitForReplyStable(options: WaitForReplyOptions): Promise<WaitForReplyResult> {
		this.record("waitForReplyStable", options);
		if (options.onInterim) await options.onInterim({ png: TINY_PNG, width: 1, height: 1 }, 0);
		const snapshot = await this.snapshot();
		return { stable: true, firstChangeMs: 10, elapsedMs: 20, snapshot };
	}

	async clickAt(x: number, y: number): Promise<void> {
		this.record("clickAt", x, y);
	}

	async typeAt(x: number, y: number, text: string, options?: { submit?: boolean }): Promise<void> {
		this.record("typeAt", x, y, text, options);
		if (options?.submit) this.queueReply();
	}

	drainConsole(): ConsoleMessage[] {
		return this.consoleQueue.splice(0);
	}

	drainNetworkFailures(): NetworkFailure[] {
		return this.networkQueue.splice(0);
	}

	async newImages(): Promise<string[]> {
		return this.imagesQueue.splice(0);
	}

	async currentUrl(): Promise<string> {
		return this.url;
	}

	async close(): Promise<void> {
		this.record("close");
		this.closed = true;
	}
}
