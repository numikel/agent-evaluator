import type { ResourceSummary } from "@schemas/api";
import { endpoints } from "../api/client.js";
import { EditorFrame } from "../components/EditorFrame.js";
import { FieldRow, NumberField, SelectField, TextField } from "../components/FormFields.js";
import { TemplateActions } from "../components/TemplateActions.js";
import { numberOf, optionalText, setKey, textOf } from "../editors/fields.js";
import { issueFor } from "../editors/issues.js";
import { referenceOptions } from "../editors/ScenarioEditor.js";
import { type Record_, toYamlText, yamlCodec } from "../editors/yaml.js";
import { useAsync } from "../hooks/useAsync.js";
import { useDocumentEditor } from "../hooks/useDocumentEditor.js";

const EVIDENCE_OPTIONS = [
	{ value: "", label: "llm (default)" },
	{ value: "llm", label: "llm — a selector model picks key steps" },
	{ value: "uniform", label: "uniform — evenly spaced steps" },
];

const saveText = (text: string) => endpoints.saveEvaluatorText(text);

function EvaluatorEditor({
	initialText,
	rubrics,
}: {
	initialText: string;
	rubrics: ResourceSummary[];
}) {
	const editor = useDocumentEditor<Record_>({
		codec: yamlCodec,
		kind: "evaluator",
		initialText,
		save: saveText,
	});
	const value = editor.value ?? {};
	const disabled = editor.value === undefined;
	const issue = (path: string) => issueFor(editor.issues, path);
	const set = (key: string, next: unknown) => editor.update((v) => setKey(v, key, next));

	return (
		<EditorFrame
			title="Evaluator"
			lead="Global principles the judge applies to every run, plus evidence limits."
			back={{ to: "/", label: "Dashboard" }}
			editor={editor}
			sourceLabel="YAML source"
			sourceHint="evaluator.yaml as it will be saved. Form edits regenerate it (comments are dropped)."
			headerActions={<TemplateActions kind="evaluator" />}
		>
			<TextField
				label="Principles"
				multiline
				rows={12}
				value={textOf(value.principles)}
				error={issue("principles")}
				hint="Natural-language rules about how the chatbot should behave; the judge reads them with the scenario, persona and rubric."
				disabled={disabled}
				onChange={(t) => set("principles", t)}
			/>
			<FieldRow>
				<NumberField
					label="Max images"
					value={numberOf(value.max_images)}
					min={0}
					max={50}
					step={1}
					error={issue("max_images")}
					hint="Screenshots passed to the judge per run (0–50)."
					disabled={disabled}
					onChange={(n) => set("max_images", n)}
				/>
				<SelectField
					label="Default rubric"
					value={textOf(value.default_rubric)}
					options={referenceOptions(rubrics, textOf(value.default_rubric), "None")}
					error={issue("default_rubric")}
					hint="Used when a scenario does not name a rubric."
					disabled={disabled}
					onChange={(t) => set("default_rubric", optionalText(t))}
				/>
				<SelectField
					label="Evidence selection"
					value={textOf(value.evidence_selection)}
					options={EVIDENCE_OPTIONS}
					error={issue("evidence_selection")}
					disabled={disabled}
					onChange={(t) => set("evidence_selection", optionalText(t))}
				/>
			</FieldRow>
			<TextField
				label="Judge instructions"
				multiline
				rows={3}
				value={textOf(value.judge_instructions)}
				error={issue("judge_instructions")}
				hint="Optional extra instructions appended to every judge prompt."
				disabled={disabled}
				onChange={(t) => set("judge_instructions", optionalText(t))}
			/>
		</EditorFrame>
	);
}

export function EvaluatorPage() {
	const load = useAsync(
		() => Promise.all([endpoints.evaluator(), endpoints.list("rubrics")]),
		"evaluator",
	);
	return (
		<div data-testid="page-evaluator">
			{load.status === "loading" ? (
				<p className="muted">Loading…</p>
			) : load.status === "error" ? (
				<p className="inline-error" role="alert">
					Could not load evaluator.yaml: {load.message}
				</p>
			) : (
				<EvaluatorEditor initialText={toYamlText(load.data[0])} rubrics={load.data[1]} />
			)}
		</div>
	);
}
