import { z } from "zod";

/** kebab-case identifier used for file names and cross references (e.g. `impatient-smb-owner`). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SlugSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(SLUG_PATTERN, "must be a kebab-case slug (lowercase letters, digits, hyphens)");

/** Explicit `provider:model` reference, e.g. `anthropic:claude-sonnet-5-5`. Bare model names are rejected on purpose. */
export const MODEL_REF_PATTERN = /^[a-z][a-z0-9_-]*:.+$/;
export const ModelRefSchema = z
	.string()
	.regex(MODEL_REF_PATTERN, "must be an explicit 'provider:model' reference");

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const HttpUrlSchema = z
	.string()
	.url()
	.refine((u) => /^https?:\/\//.test(u), "must be an http(s) URL");

export type ValidationIssue = { path: string; message: string };

export class ValidationError extends Error {
	readonly issues: ValidationIssue[];
	readonly source: string | undefined;

	constructor(source: string | undefined, issues: ValidationIssue[]) {
		const where = source ? ` in ${source}` : "";
		const lines = issues.map((i) => `  - ${i.path || "<root>"}: ${i.message}`).join("\n");
		super(`Validation failed${where}:\n${lines}`);
		this.name = "ValidationError";
		this.issues = issues;
		this.source = source;
	}
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: ValidationError };

/** Safe parse that converts zod issues into a readable {@link ValidationError} mentioning the source file. */
export function parseWith<S extends z.ZodType>(
	schema: S,
	input: unknown,
	source?: string,
): ParseResult<z.output<S>> {
	const result = schema.safeParse(input);
	if (result.success) return { ok: true, data: result.data };
	const issues = result.error.issues.map((i) => ({
		path: i.path.map(String).join("."),
		message: i.message,
	}));
	return { ok: false, error: new ValidationError(source, issues) };
}

/** Like {@link parseWith} but throws the {@link ValidationError}. */
export function parseOrThrow<S extends z.ZodType>(
	schema: S,
	input: unknown,
	source?: string,
): z.output<S> {
	const r = parseWith(schema, input, source);
	if (!r.ok) throw r.error;
	return r.data;
}
