/** Helpers for "new from template" and "upload file": naming documents from raw text. */
import type { ResourceKind } from "@schemas/api";
import { personaCodec } from "./persona.js";
import { parseYamlDocument } from "./yaml.js";

const TOP_LEVEL_NAME = /^name:[^\n]*$/m;

/** Sets the top-level `name:` of a YAML document or persona frontmatter to `name`. */
export function renameDocument(text: string, name: string): string {
	if (TOP_LEVEL_NAME.test(text)) return text.replace(TOP_LEVEL_NAME, `name: ${name}`);
	return `name: ${name}\n${text}`;
}

/** The `name` declared inside a document, when it parses and has one. */
export function documentName(kind: ResourceKind, text: string): string | undefined {
	let record: Record<string, unknown>;
	if (kind === "persona") {
		const parsed = personaCodec.parse(text);
		if (!parsed.ok) return undefined;
		record = parsed.value.frontmatter;
	} else {
		const parsed = parseYamlDocument(text);
		if (!parsed.ok) return undefined;
		record = parsed.value;
	}
	const name = record.name;
	return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** `My Persona (v2).md` → `my-persona-v2`; empty when nothing usable remains. */
export function slugFromFilename(filename: string): string {
	return filename
		.replace(/\.[^.]*$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Download file name the server advertises for each template kind. */
export const TEMPLATE_FILENAMES: Record<ResourceKind, string> = {
	persona: "PERSONA.md",
	scenario: "scenario.yaml",
	rubric: "rubric.yaml",
	target: "target.yaml",
	evaluator: "evaluator.yaml",
	settings: "agent-evaluator.yaml",
};
