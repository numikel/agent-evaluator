/**
 * State for a split form ⇄ source editor. The raw text is the single source of truth: the form
 * value is derived from it on every render through the codec, and form edits are applied by
 * re-serialising the parsed value. Validation goes through `POST /api/validate` and is cached
 * per text; saving validates first and sends the text as-is (comments survive source edits).
 */
import type { ResourceKind } from "@schemas/api";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiValidationError, endpoints } from "../api/client.js";
import type { Issue } from "../editors/issues.js";
import type { Codec } from "../editors/yaml.js";
import { errorMessage } from "./useAsync.js";

export type EditorStatus =
	| { kind: "idle" }
	| { kind: "validating" }
	| { kind: "saving" }
	| { kind: "saved" }
	| { kind: "error"; message: string };

export type DocumentEditor<T> = {
	text: string;
	/** Parsed value, `undefined` while the source does not parse. */
	value: T | undefined;
	parseError: string | undefined;
	issues: Issue[];
	status: EditorStatus;
	dirty: boolean;
	setText(text: string): void;
	update(mutate: (value: T) => T): void;
	/** Validates the current text on the server; resolves with `true` when it is valid. */
	validate(): Promise<boolean>;
	save(): Promise<boolean>;
};

export type UseDocumentEditorOptions<T> = {
	codec: Codec<T>;
	kind: ResourceKind;
	initialText: string;
	save(text: string): Promise<unknown>;
	onSaved?(): void;
};

export function useDocumentEditor<T>({
	codec,
	kind,
	initialText,
	save,
	onSaved,
}: UseDocumentEditorOptions<T>): DocumentEditor<T> {
	const [text, setTextState] = useState(initialText);
	const [savedText, setSavedText] = useState(initialText);
	const [issues, setIssues] = useState<Issue[]>([]);
	const [status, setStatus] = useState<EditorStatus>({ kind: "idle" });
	const validated = useRef<{ text: string; ok: boolean } | undefined>(undefined);
	const latest = useRef(text);
	useEffect(() => {
		latest.current = text;
	}, [text]);

	const parsed = useMemo(() => codec.parse(text), [codec, text]);

	const setText = useCallback((next: string) => {
		setTextState(next);
		setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
	}, []);

	const update = useCallback(
		(mutate: (value: T) => T) => {
			setTextState((prev) => {
				const current = codec.parse(prev);
				return current.ok ? codec.stringify(mutate(current.value)) : prev;
			});
			setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
		},
		[codec],
	);

	const validate = useCallback(async (): Promise<boolean> => {
		const snapshot = text;
		if (validated.current?.text === snapshot) return validated.current.ok;
		setStatus({ kind: "validating" });
		try {
			const result = await endpoints.validate(kind, snapshot);
			validated.current = { text: snapshot, ok: result.ok };
			if (latest.current !== snapshot) return result.ok;
			startTransition(() => {
				setIssues(result.ok ? [] : result.issues);
				setStatus((s) => (s.kind === "validating" ? { kind: "idle" } : s));
			});
			return result.ok;
		} catch (error) {
			setStatus({ kind: "error", message: `Validation failed: ${errorMessage(error)}` });
			return false;
		}
	}, [kind, text]);

	const doSave = useCallback(async (): Promise<boolean> => {
		const snapshot = text;
		const ok = await validate();
		if (!ok) {
			setStatus((s) =>
				s.kind === "error" ? s : { kind: "error", message: "Fix the issues below before saving." },
			);
			return false;
		}
		setStatus({ kind: "saving" });
		try {
			await save(snapshot);
			setSavedText(snapshot);
			setIssues([]);
			setStatus({ kind: "saved" });
			onSaved?.();
			return true;
		} catch (error) {
			if (error instanceof ApiValidationError) {
				setIssues(error.issues);
				validated.current = { text: snapshot, ok: false };
				setStatus({ kind: "error", message: "The server rejected the document." });
			} else {
				setStatus({ kind: "error", message: `Save failed: ${errorMessage(error)}` });
			}
			return false;
		}
	}, [text, validate, save, onSaved]);

	return {
		text,
		value: parsed.ok ? parsed.value : undefined,
		parseError: parsed.ok ? undefined : parsed.error,
		issues,
		status,
		dirty: text !== savedText,
		setText,
		update,
		validate,
		save: doSave,
	};
}
