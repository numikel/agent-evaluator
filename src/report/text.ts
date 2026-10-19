/** Escaping and formatting helpers shared by the HTML and JUnit renderers. */

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Escapes text for HTML element content and attribute values (double-quoted). */
export function escapeHtml(value: unknown): string {
	return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 forbids these code points
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Escapes text for XML content and attribute values; strips characters XML 1.0 cannot carry. */
export function escapeXml(value: unknown): string {
	return String(value ?? "")
		.replace(XML_INVALID, "")
		.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** `round(score * 100)` — the one definition of "percent" used everywhere. */
export function percent(score: number): number {
	return Math.round(score * 100);
}

/** Seconds between two ISO timestamps, as a fixed 3-decimal string; `0.000` when unknown. */
export function secondsBetween(start: string | undefined, end: string | undefined): string {
	if (!start || !end) return "0.000";
	const ms = Date.parse(end) - Date.parse(start);
	if (!Number.isFinite(ms) || ms < 0) return "0.000";
	return (ms / 1000).toFixed(3);
}

/** Human-readable byte count (`18.0 kB`, `1.2 MB`). */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["kB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
}

/** Shortens text for labels and titles, keeping it single-line. */
export function truncate(text: string, max = 80): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** Turns a run-relative path into a safe DOM id, e.g. `steps/003/after.png` → `shot-steps-003-after-png`. */
export function anchorForScreenshot(relativePath: string): string {
	return `shot-${relativePath.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}
