/**
 * FROZEN CONTRACT (P0). The simulator agent (P6) and the runner (P10) depend only on this interface;
 * `PlaywrightSession` (P2) implements it and `FakeBrowserSession` (src/testing) doubles it.
 * Changing it requires an ADR note and notifying dependent phases.
 */

export type ScrollDirection = "up" | "down";

export type SnapshotResult = {
	/** YAML-ish accessibility tree with `[ref=eN]` markers (Playwright `ariaSnapshot({ mode: "ai" })`). */
	tree: string;
	url: string;
	title: string;
};

export type ScreenshotResult = {
	/** PNG bytes. */
	png: Uint8Array;
	width: number;
	height: number;
};

export type DownloadResult = {
	/** Suggested file name reported by the browser. */
	filename: string;
	/** Absolute path where the file was saved. */
	path: string;
	mime: string | undefined;
	bytes: number;
};

export type ConsoleMessage = {
	level: "log" | "info" | "warn" | "error";
	text: string;
	at: string;
};

export type NetworkFailure = { url: string; status: number | undefined; error: string | undefined };

export type WaitForReplyOptions = {
	/** Give up after this long without a stable reply (default from target.timeouts.response_ms). */
	timeoutMs: number;
	/** Reply counts as complete when the page is unchanged for this long. */
	stableMs: number;
	/** Called every `captureIntervalMs` while waiting; implementations pass an interim screenshot. */
	onInterim?: (shot: ScreenshotResult, elapsedMs: number) => void | Promise<void>;
	captureIntervalMs?: number;
};

export type WaitForReplyResult = {
	/** `true` if the page stabilised before the timeout. */
	stable: boolean;
	/** Time until the first change was observed (bot started answering), if any. */
	firstChangeMs: number | undefined;
	/** Total wait time. */
	elapsedMs: number;
	/** Snapshot taken after stabilisation (or at timeout). */
	snapshot: SnapshotResult;
};

export type BrowserSessionOptions = {
	headless: boolean;
	viewport: { width: number; height: number };
	/** Directory where downloads are saved. */
	downloadDir: string;
	storageStatePath?: string;
	slowMoMs?: number;
	navigationTimeoutMs: number;
};

/** A single browser tab the simulator drives. Every mutating method should be cheap to screenshot around. */
export interface BrowserSession {
	open(url: string): Promise<void>;
	snapshot(): Promise<SnapshotResult>;
	screenshot(): Promise<ScreenshotResult>;
	click(ref: string): Promise<void>;
	/** Types into the element; `submit` presses Enter afterwards. */
	type(ref: string, text: string, options?: { submit?: boolean; clear?: boolean }): Promise<void>;
	press(key: string): Promise<void>;
	scroll(direction: ScrollDirection, amount?: number): Promise<void>;
	wait(ms: number): Promise<void>;
	/** Clicks `ref` and captures the resulting download. Rejects if no download starts within the timeout. */
	download(ref: string, timeoutMs?: number): Promise<DownloadResult>;
	/** Sets files on the file chooser opened by clicking `ref`. */
	upload(ref: string, filePaths: string[]): Promise<void>;
	/** Waits until the page content stops changing (bot reply finished streaming). */
	waitForReplyStable(options: WaitForReplyOptions): Promise<WaitForReplyResult>;
	/** Vision-mode primitives (CSS pixels relative to the viewport). */
	clickAt(x: number, y: number): Promise<void>;
	typeAt(x: number, y: number, text: string, options?: { submit?: boolean }): Promise<void>;
	/** Console messages collected since the last call (drained). */
	drainConsole(): ConsoleMessage[];
	/** Failed requests (4xx/5xx/network errors) collected since the last call (drained). */
	drainNetworkFailures(): NetworkFailure[];
	/** Images rendered in the page that were not present at the last snapshot (absolute URLs). */
	newImages(): Promise<string[]>;
	currentUrl(): Promise<string>;
	close(): Promise<void>;
}

export interface BrowserSessionFactory {
	create(options: BrowserSessionOptions): Promise<BrowserSession>;
}
