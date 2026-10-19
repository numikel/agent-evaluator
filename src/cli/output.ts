/**
 * Tiny output helpers for the CLI: ANSI colours (honouring `NO_COLOR` / `FORCE_COLOR` and TTY
 * detection), a fixed-width table and text truncation. No dependencies.
 */

export const CHECK = "✓";
export const CROSS = "✗";

/** Ends the command with `exitCode` after the message has been written to stderr by `runCli`. */
export class CliExitError extends Error {
	override readonly name = "CliExitError";
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message);
	}
}

export type Paint = (text: string) => string;

export type Palette = {
	green: Paint;
	red: Paint;
	yellow: Paint;
	cyan: Paint;
	dim: Paint;
	bold: Paint;
};

const CODES = { green: 32, red: 31, yellow: 33, cyan: 36, dim: 2, bold: 1 } as const;

/**
 * `NO_COLOR` (any non-empty value) disables colours, `FORCE_COLOR` (anything but `0`) enables
 * them, otherwise colours follow whether stdout is a terminal.
 */
export function colorEnabled(env: Record<string, string | undefined>, isTty: boolean): boolean {
	const noColor = env.NO_COLOR;
	if (noColor !== undefined && noColor !== "") return false;
	const forceColor = env.FORCE_COLOR;
	if (forceColor !== undefined && forceColor !== "" && forceColor !== "0") return true;
	return isTty;
}

export function createPalette(enabled: boolean): Palette {
	const paint =
		(code: number): Paint =>
		(text) =>
			enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
	return {
		green: paint(CODES.green),
		red: paint(CODES.red),
		yellow: paint(CODES.yellow),
		cyan: paint(CODES.cyan),
		dim: paint(CODES.dim),
		bold: paint(CODES.bold),
	};
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences start with ESC
const ANSI = /\u001b\[[0-9;]*m/g;

/** Width of `text` as printed (ANSI colour codes stripped). */
export function visibleWidth(text: string): number {
	return [...text.replace(ANSI, "")].length;
}

function padEnd(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

/** Left-aligned columns separated by two spaces, with a dashed rule under the header. */
export function formatTable(headers: string[], rows: string[][]): string {
	const widths = headers.map((header, column) =>
		Math.max(visibleWidth(header), ...rows.map((row) => visibleWidth(row[column] ?? ""))),
	);
	const line = (cells: string[]) =>
		cells
			.map((cell, column) =>
				column === cells.length - 1 ? cell : padEnd(cell, widths[column] ?? 0),
			)
			.join("  ")
			.trimEnd();
	return [
		line(headers),
		widths.map((width) => "-".repeat(width)).join("  "),
		...rows.map((row) => line(row)),
	].join("\n");
}

/** Collapses whitespace and cuts `text` to `max` characters with an ellipsis. */
export function truncate(text: string, max = 80): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (compact.length <= max) return compact;
	return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

/** `0.874` → `87%`; `undefined` → `-`. */
export function formatPercent(score: number | undefined): string {
	return score === undefined ? "-" : `${Math.round(score * 100)}%`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pluralises `noun` for `count` (`1 run`, `2 runs`). */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
	return `${count} ${count === 1 ? noun : pluralNoun}`;
}
