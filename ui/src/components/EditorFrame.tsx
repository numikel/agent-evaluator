/**
 * Chrome shared by every split editor: header with view toggle + Validate/Save, live status,
 * issue summary, and the form ⇄ source panes. Blur anywhere inside triggers server validation.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Issue } from "../editors/issues.js";
import type { DocumentEditor, EditorStatus } from "../hooks/useDocumentEditor.js";
import { Button } from "./Button.js";
import { Field } from "./Field.js";
import { PageHeader } from "./PageHeader.js";

type View = "form" | "split" | "source";

const VIEWS: readonly { id: View; label: string }[] = [
	{ id: "form", label: "Form" },
	{ id: "split", label: "Split" },
	{ id: "source", label: "Source" },
];

export type EditorFrameProps<T> = {
	title: string;
	lead?: ReactNode;
	back: { to: string; label: string };
	editor: DocumentEditor<T>;
	sourceLabel: string;
	sourceHint?: string;
	/** Client-side issues that block saving (e.g. the name does not match the file). */
	blockingIssues?: readonly Issue[];
	/** The form; rendered disabled by the caller when `editor.value` is undefined. */
	children: ReactNode;
	/** Optional panel under the panes (e.g. the rubric score preview). */
	aside?: ReactNode;
	headerActions?: ReactNode;
};

function statusText(status: EditorStatus, dirty: boolean): string {
	switch (status.kind) {
		case "validating":
			return "Validating…";
		case "saving":
			return "Saving…";
		case "saved":
			return "Saved.";
		case "error":
			return status.message;
		case "idle":
			return dirty ? "Unsaved changes." : "";
	}
}

export function EditorFrame<T>({
	title,
	lead,
	back,
	editor,
	sourceLabel,
	sourceHint,
	blockingIssues = [],
	children,
	aside,
	headerActions,
}: EditorFrameProps<T>) {
	const [view, setView] = useState<View>("split");
	const frame = useRef<HTMLDivElement>(null);
	const issues = [...blockingIssues, ...editor.issues];
	const canSave =
		editor.parseError === undefined &&
		blockingIssues.length === 0 &&
		editor.status.kind !== "saving" &&
		editor.status.kind !== "validating";
	const status = statusText(editor.status, editor.dirty);

	// Unsaved edits live only in memory: warn before the tab is closed or reloaded.
	useEffect(() => {
		if (!editor.dirty) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [editor.dirty]);

	const save = async () => {
		const saved = await editor.save();
		if (saved) return;
		// Focus the first field flagged by the server so keyboard users land on the problem.
		const invalid = frame.current?.querySelector<HTMLElement>("[aria-invalid='true']");
		invalid?.focus();
	};

	return (
		<>
			<PageHeader
				title={title}
				lead={
					<>
						{lead ? <span>{lead} </span> : null}
						<Link to={back.to}>{back.label}</Link>
					</>
				}
				actions={
					<>
						<fieldset className="segmented">
							<legend className="visually-hidden">View</legend>
							{VIEWS.map((v) => (
								<button
									key={v.id}
									type="button"
									className="segmented__btn"
									aria-pressed={view === v.id}
									onClick={() => setView(v.id)}
								>
									{v.label}
								</button>
							))}
						</fieldset>
						{headerActions}
						<Button
							onClick={() => void editor.validate()}
							disabled={editor.status.kind === "saving"}
						>
							Validate
						</Button>
						<Button variant="primary" onClick={() => void save()} disabled={!canSave}>
							Save
						</Button>
					</>
				}
			/>
			<p
				className={`editor__status${editor.status.kind === "error" ? " editor__status--error" : ""}`}
				role="status"
				aria-live="polite"
			>
				{status}
			</p>
			{issues.length > 0 ? (
				<section className="issues" aria-labelledby="editor-issues-title">
					<h2 id="editor-issues-title" className="issues__title">
						Issues ({issues.length})
					</h2>
					<ul className="issues__list">
						{issues.map((issue) => (
							<li key={`${issue.path}:${issue.message}`}>
								<code className="mono">{issue.path || "<document>"}</code> {issue.message}
							</li>
						))}
					</ul>
				</section>
			) : null}
			<div className={`editor editor--${view}`} ref={frame}>
				{/* Blur bubbles from every control, so leaving any field validates the document. */}
				<form
					className="editor__form"
					aria-label="Form"
					onBlur={() => void editor.validate()}
					onSubmit={(e) => {
						e.preventDefault();
						if (canSave) void save();
					}}
				>
					{editor.parseError !== undefined ? (
						<p className="notice notice--warn">
							The form is read-only until the source parses again.
						</p>
					) : null}
					{children}
				</form>
				<div className="editor__source">
					<Field label={sourceLabel} hint={sourceHint} error={editor.parseError}>
						{(control) => (
							<textarea
								{...control}
								className="mono source"
								value={editor.text}
								spellCheck={false}
								onChange={(e) => editor.setText(e.target.value)}
								onBlur={() => void editor.validate()}
							/>
						)}
					</Field>
				</div>
			</div>
			{aside}
		</>
	);
}
