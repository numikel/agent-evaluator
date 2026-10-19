/**
 * Persona Markdown ⇄ `{ frontmatter, body }`. Mirrors the server's `splitFrontmatter` /
 * `joinFrontmatter` so a document that round-trips here is byte-identical to what the API writes.
 */
import {
	type Codec,
	type ParseOutcome,
	parseYamlDocument,
	type Record_,
	toYamlText,
} from "./yaml.js";

export type PersonaDraft = { frontmatter: Record_; body: string };

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/;

function parsePersonaMarkdown(text: string): ParseOutcome<PersonaDraft> {
	const match = FRONTMATTER.exec(text);
	if (!match) {
		return {
			ok: false,
			error: "The document must start with a YAML frontmatter block delimited by `---` lines.",
		};
	}
	const frontmatter = parseYamlDocument(match[1] ?? "");
	if (!frontmatter.ok) return { ok: false, error: `Frontmatter: ${frontmatter.error}` };
	// The API returns the body with its leading blank line; the form shows it without.
	const body = (match[2] ?? "").replace(/^\r?\n/, "");
	return { ok: true, value: { frontmatter: frontmatter.value, body } };
}

function personaToMarkdown({ frontmatter, body }: PersonaDraft): string {
	const yaml = toYamlText(frontmatter).trimEnd();
	const trimmedBody = body.replace(/^\r?\n+/, "");
	const tail = trimmedBody.endsWith("\n") || trimmedBody === "" ? "" : "\n";
	return `---\n${yaml}\n---\n\n${trimmedBody}${tail}`;
}

export const personaCodec: Codec<PersonaDraft> = {
	parse: parsePersonaMarkdown,
	stringify: personaToMarkdown,
};
