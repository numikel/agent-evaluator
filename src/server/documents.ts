/**
 * Serialisation helpers shared by the API and the in-memory fakes: persona Markdown with YAML
 * frontmatter, and YAML for every other resource. P1 ships its own `splitFrontmatter`; this copy is
 * deliberately tiny so the server has no dependency on the workspace implementation.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ResourceKind } from "../schemas/index.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Splits `---\n<yaml>\n---\n<body>`; returns `undefined` when there is no frontmatter block. */
export function splitFrontmatter(
	markdown: string,
): { frontmatter: unknown; body: string } | undefined {
	const match = FRONTMATTER.exec(markdown);
	if (!match) return undefined;
	return { frontmatter: parseYaml(match[1] ?? "") ?? {}, body: match[2] ?? "" };
}

export function joinFrontmatter(frontmatter: unknown, body: string): string {
	const yaml = stringifyYaml(frontmatter).trimEnd();
	const trimmedBody = body.replace(/^\r?\n+/, "");
	return `---\n${yaml}\n---\n\n${trimmedBody}${trimmedBody.endsWith("\n") || trimmedBody === "" ? "" : "\n"}`;
}

export function toYaml(value: unknown): string {
	return stringifyYaml(value);
}

export function fromYaml(text: string): unknown {
	return parseYaml(text);
}

/** File name used when a template is downloaded. */
export const TEMPLATE_FILENAMES: Record<ResourceKind, string> = {
	persona: "PERSONA.md",
	scenario: "scenario.yaml",
	rubric: "rubric.yaml",
	target: "target.yaml",
	evaluator: "evaluator.yaml",
	settings: "agent-evaluator.yaml",
};
