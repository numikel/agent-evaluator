/**
 * "Download template" (plain link with `download`) and "Upload file" (read → validate →
 * PUT raw text under the document's own name). Used on the resource list pages.
 */
import type { ResourceKind } from "@schemas/api";
import { useId, useState } from "react";
import { ApiValidationError, type Collection, endpoints } from "../api/client.js";
import type { Issue } from "../editors/issues.js";
import { documentName, slugFromFilename, TEMPLATE_FILENAMES } from "../editors/templates.js";
import { errorMessage } from "../hooks/useAsync.js";

export type TemplateActionsProps = {
	kind: ResourceKind;
	/** Upload is offered only for collections; `evaluator`/`settings` get the download alone. */
	collection?: Collection;
	onUploaded?(name: string): void;
};

type UploadState =
	| { kind: "idle" }
	| { kind: "busy"; file: string }
	| { kind: "error"; message: string; issues: Issue[] };

async function readText(file: File): Promise<string> {
	if (typeof file.text === "function") return file.text();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
		reader.readAsText(file);
	});
}

export function TemplateActions({ kind, collection, onUploaded }: TemplateActionsProps) {
	const [state, setState] = useState<UploadState>({ kind: "idle" });
	const errorId = useId();

	const upload = async (file: File) => {
		if (!collection) return;
		setState({ kind: "busy", file: file.name });
		try {
			const text = await readText(file);
			const result = await endpoints.validate(kind, text);
			if (!result.ok) {
				setState({
					kind: "error",
					message: `${file.name} is not a valid ${kind} file.`,
					issues: result.issues,
				});
				return;
			}
			const name = documentName(kind, text) ?? slugFromFilename(file.name);
			if (!name) {
				setState({
					kind: "error",
					message: "Could not derive a name from the file; add a `name:` field.",
					issues: [],
				});
				return;
			}
			await endpoints.saveResourceText(collection, name, text);
			setState({ kind: "idle" });
			onUploaded?.(name);
		} catch (error) {
			setState({
				kind: "error",
				message: `Upload failed: ${errorMessage(error)}`,
				issues: error instanceof ApiValidationError ? error.issues : [],
			});
		}
	};

	return (
		<div className="template-actions">
			<a className="btn" href={endpoints.templateUrl(kind)} download={TEMPLATE_FILENAMES[kind]}>
				Download template
			</a>
			{collection ? (
				<label className={`btn file-btn${state.kind === "busy" ? " btn--busy" : ""}`}>
					{state.kind === "busy" ? `Uploading ${state.file}…` : "Upload file"}
					<input
						type="file"
						accept=".md,.yaml,.yml,text/markdown,text/yaml,application/yaml,text/plain"
						disabled={state.kind === "busy"}
						aria-describedby={state.kind === "error" ? errorId : undefined}
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (file) void upload(file);
						}}
					/>
				</label>
			) : null}
			{state.kind === "error" ? (
				<div className="notice notice--error" role="alert" id={errorId}>
					<p>{state.message}</p>
					{state.issues.length > 0 ? (
						<ul className="issues__list">
							{state.issues.map((issue) => (
								<li key={`${issue.path}:${issue.message}`}>
									<code className="mono">{issue.path || "<document>"}</code> {issue.message}
								</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</div>
	);
}
