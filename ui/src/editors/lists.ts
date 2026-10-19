/** Small pure helpers for list-valued fields (tags, hints, examples). */

export function splitCommaList(text: string): string[] {
	return text
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function joinCommaList(items: readonly string[]): string {
	return items.join(", ");
}

export function splitLines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function joinLines(items: readonly string[]): string {
	return items.join("\n");
}

/** Coerces whatever a hand-edited document holds into a list of strings (nulls dropped). */
export function stringList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((v) => v !== null && v !== undefined).map((v) => String(v));
	}
	if (value === undefined || value === null || value === "") return [];
	return [String(value)];
}
