/**
 * Loads a collection document (or the template for `?new=1`), hands a {@link DocumentEditor}
 * to the concrete form and saves the raw text with `PUT /api/<collection>/<name>`.
 */
import type { ResourceKind } from "@schemas/api";
import { type ReactNode, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { type Collection, endpoints } from "../api/client.js";
import { EditorFrame } from "../components/EditorFrame.js";
import { useAsync } from "../hooks/useAsync.js";
import { type DocumentEditor, useDocumentEditor } from "../hooks/useDocumentEditor.js";
import type { Issue } from "./issues.js";
import { renameDocument } from "./templates.js";
import type { Codec } from "./yaml.js";

export type ResourceEditorProps<T, E> = {
	collection: Collection;
	kind: ResourceKind;
	name: string;
	title: string;
	lead?: string;
	codec: Codec<T>;
	/** Turns the JSON document from the API into file text. */
	toText(doc: unknown): string;
	/** Extra data the form needs (reference lists); loaded in parallel with the document. */
	loadExtras?: () => Promise<E>;
	sourceLabel: string;
	sourceHint?: string;
	/** Where the document declares its name; must match the URL name to be saveable. */
	nameOf(value: T): unknown;
	namePath: string;
	children(editor: DocumentEditor<T>, extras: E): ReactNode;
	aside?(editor: DocumentEditor<T>): ReactNode;
};

export function ResourceEditor<T, E = undefined>(props: ResourceEditorProps<T, E>) {
	const { collection, kind, name, codec, toText, loadExtras, title } = props;
	const [search] = useSearchParams();
	const isNew = search.get("new") === "1";
	const load = useAsync(
		async () => {
			const text = isNew
				? endpoints.template(kind).then((t) => renameDocument(t, name))
				: endpoints.resource(collection, name).then(toText);
			const extras = loadExtras ? loadExtras() : Promise.resolve(undefined as E);
			const [initialText, loaded] = await Promise.all([text, extras]);
			return { initialText, extras: loaded };
		},
		`${collection}/${name}/${isNew ? "new" : "saved"}`,
	);

	if (load.status === "loading") {
		return (
			<>
				<h1 className="page-title">
					{title} / {name}
				</h1>
				<p className="muted">Loading…</p>
			</>
		);
	}
	if (load.status === "error") {
		return (
			<>
				<h1 className="page-title">
					{title} / {name}
				</h1>
				<p className="inline-error" role="alert">
					Could not load {kind} "{name}": {load.message}
				</p>
			</>
		);
	}
	return (
		<Loaded
			key={`${name}:${isNew ? "new" : "saved"}`}
			{...props}
			codec={codec}
			isNew={isNew}
			initialText={load.data.initialText}
			extras={load.data.extras}
		/>
	);
}

type LoadedProps<T, E> = ResourceEditorProps<T, E> & {
	isNew: boolean;
	initialText: string;
	extras: E;
};

function Loaded<T, E>({
	collection,
	kind,
	name,
	title,
	lead,
	codec,
	sourceLabel,
	sourceHint,
	nameOf,
	namePath,
	children,
	aside,
	isNew,
	initialText,
	extras,
}: LoadedProps<T, E>) {
	const navigate = useNavigate();
	const save = useCallback(
		(text: string) => endpoints.saveResourceText(collection, name, text),
		[collection, name],
	);
	const onSaved = useCallback(() => {
		if (isNew) void navigate(`/${collection}/${encodeURIComponent(name)}`, { replace: true });
	}, [isNew, navigate, collection, name]);
	const editor = useDocumentEditor<T>({ codec, kind, initialText, save, onSaved });

	const blockingIssues: Issue[] = [];
	if (editor.value !== undefined && nameOf(editor.value) !== name) {
		blockingIssues.push({ path: namePath, message: `must match the file name "${name}"` });
	}

	// The form sees client-side issues inline as well, so the name field can flag itself.
	const formEditor: DocumentEditor<T> =
		blockingIssues.length === 0
			? editor
			: { ...editor, issues: [...blockingIssues, ...editor.issues] };

	return (
		<EditorFrame
			title={`${title} / ${name}`}
			lead={isNew ? `New ${kind} from the template — not saved yet.` : lead}
			back={{ to: `/${collection}`, label: `Back to ${collection}` }}
			editor={editor}
			sourceLabel={sourceLabel}
			sourceHint={sourceHint}
			blockingIssues={blockingIssues}
			aside={aside?.(editor)}
		>
			{children(formEditor, extras)}
		</EditorFrame>
	);
}
