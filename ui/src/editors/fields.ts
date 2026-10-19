/** Loose accessors for hand-edited records: the form must cope with any YAML the user typed. */
import type { Record_ } from "./yaml.js";

export const textOf = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	if (typeof value === "object") return "";
	return String(value);
};

export const numberOf = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const boolOf = (value: unknown): boolean => value === true;

export const recordOf = (value: unknown): Record_ =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record_) : {};

export const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Returns a copy with `key` set, or without it when `value` is `undefined` (key order kept). */
export function setKey(record: Record_, key: string, value: unknown): Record_ {
	if (value === undefined) {
		if (!(key in record)) return record;
		return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
	}
	return { ...record, [key]: value };
}

/** Like {@link setKey} for a nested path; empty intermediate objects are removed on the way back. */
export function setPath(record: Record_, path: readonly string[], value: unknown): Record_ {
	const [head, ...rest] = path;
	if (head === undefined) return record;
	if (rest.length === 0) return setKey(record, head, value);
	const child = setPath(recordOf(record[head]), rest, value);
	return setKey(record, head, Object.keys(child).length === 0 ? undefined : child);
}

/** `""` → `undefined` so optional string fields disappear from the document when cleared. */
export const optionalText = (text: string): string | undefined => (text === "" ? undefined : text);
