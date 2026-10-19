import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

export type SplitFrontmatter = { frontmatter: unknown; body: string };

/**
 * Splits a Markdown document into its leading YAML frontmatter block and the body that follows.
 * Throws an `Error` naming `source` (when given) if the block is missing or the YAML is invalid.
 */
export function splitFrontmatter(markdown: string, source?: string): SplitFrontmatter {
	const where = source ? ` in ${source}` : "";
	const match = FRONTMATTER_PATTERN.exec(markdown);
	if (!match) {
		throw new Error(`Missing YAML frontmatter${where}: the file must start with a '---' block`);
	}
	let frontmatter: unknown;
	try {
		frontmatter = parseYaml(match[1] ?? "") ?? {};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid YAML frontmatter${where}: ${reason}`);
	}
	return { frontmatter, body: match[2] ?? "" };
}

/**
 * Inverse of {@link splitFrontmatter}: `---\n<yaml>---\n\n<body>`. A body that already starts
 * with a blank line (as returned by `splitFrontmatter`) is appended as-is so the pair round-trips.
 */
export function joinFrontmatter(frontmatter: unknown, body: string): string {
	const yaml = stringifyYaml(frontmatter ?? {});
	const separator = body === "" || body.startsWith("\n") || body.startsWith("\r\n") ? "" : "\n";
	return `---\n${yaml}---\n${separator}${body}`;
}
