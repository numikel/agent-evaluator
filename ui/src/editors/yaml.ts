/**
 * YAML ⇄ record conversion for the split editors. Pure, browser-side (`yaml` package); the
 * server stays the authority on validation, this only has to parse and re-emit text.
 */
import { parse, stringify } from "yaml";

export type Record_ = Record<string, unknown>;
export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** A codec turns raw file text into an editable value and back. */
export type Codec<T> = {
	parse(text: string): ParseOutcome<T>;
	stringify(value: T): string;
};

export function isRecord(value: unknown): value is Record_ {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a YAML document that must be a mapping (empty documents count as `{}`). */
export function parseYamlDocument(text: string): ParseOutcome<Record_> {
	let value: unknown;
	try {
		value = parse(text);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	if (value === null || value === undefined) return { ok: true, value: {} };
	if (!isRecord(value)) return { ok: false, error: "The document must be a YAML mapping." };
	return { ok: true, value };
}

/** Serialises a value as YAML; `undefined` keys are dropped like the server's `toYaml`. */
export function toYamlText(value: unknown): string {
	return stringify(value);
}

export const yamlCodec: Codec<Record_> = {
	parse: parseYamlDocument,
	stringify: toYamlText,
};
