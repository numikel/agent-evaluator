import type { ResourceSummary } from "@schemas/api";
import { endpoints } from "../api/client.js";
import { Button } from "../components/Button.js";
import {
	CheckboxField,
	FieldRow,
	LinesField,
	NumberField,
	SelectField,
	type SelectOption,
	TagsField,
	TextField,
} from "../components/FormFields.js";
import type { DocumentEditor } from "../hooks/useDocumentEditor.js";
import { boolOf, listOf, numberOf, optionalText, recordOf, setKey, textOf } from "./fields.js";
import { issueFor } from "./issues.js";
import { stringList } from "./lists.js";
import { ResourceEditor } from "./ResourceEditor.js";
import { type Record_, toYamlText, yamlCodec } from "./yaml.js";

type Extras = {
	personas: ResourceSummary[];
	targets: ResourceSummary[];
	rubrics: ResourceSummary[];
};

const ARTIFACT_TYPES: SelectOption[] = [
	{ value: "download", label: "Download" },
	{ value: "image", label: "Image" },
	{ value: "link", label: "Link" },
];

/** Options from a workspace list, keeping the current value selectable even when it is missing. */
export function referenceOptions(
	list: readonly ResourceSummary[],
	current: string,
	empty?: string,
): SelectOption[] {
	const options: SelectOption[] = empty !== undefined ? [{ value: "", label: empty }] : [];
	for (const item of list) options.push({ value: item.name, label: item.name });
	if (current !== "" && !list.some((i) => i.name === current)) {
		options.push({ value: current, label: `${current} (not in workspace)` });
	}
	return options;
}

const loadExtras = async (): Promise<Extras> => {
	const [personas, targets, rubrics] = await Promise.all([
		endpoints.list("personas"),
		endpoints.list("targets"),
		endpoints.list("rubrics"),
	]);
	return { personas, targets, rubrics };
};

function ScenarioForm({ editor, extras }: { editor: DocumentEditor<Record_>; extras: Extras }) {
	const value = editor.value ?? {};
	const disabled = editor.value === undefined;
	const issue = (path: string) => issueFor(editor.issues, path);
	const set = (key: string, next: unknown) => editor.update((v) => setKey(v, key, next));
	const artifacts = listOf(value.expected_artifacts).map(recordOf);
	const setArtifacts = (next: Record_[]) => set("expected_artifacts", next);

	return (
		<>
			<FieldRow>
				<TextField
					label="Name"
					mono
					value={textOf(value.name)}
					error={issue("name")}
					hint="Kebab-case slug; must equal the file name."
					disabled={disabled}
					onChange={(t) => set("name", t)}
				/>
				<TextField
					label="Description"
					value={textOf(value.description)}
					error={issue("description")}
					disabled={disabled}
					onChange={(t) => set("description", optionalText(t))}
				/>
			</FieldRow>
			<FieldRow>
				<SelectField
					label="Persona"
					value={textOf(value.persona)}
					options={referenceOptions(extras.personas, textOf(value.persona), "Choose a persona")}
					error={issue("persona")}
					disabled={disabled}
					onChange={(t) => set("persona", optionalText(t))}
				/>
				<SelectField
					label="Target"
					value={textOf(value.target)}
					options={referenceOptions(extras.targets, textOf(value.target), "Choose a target")}
					error={issue("target")}
					disabled={disabled}
					onChange={(t) => set("target", optionalText(t))}
				/>
				<SelectField
					label="Rubric"
					value={textOf(value.rubric)}
					options={referenceOptions(extras.rubrics, textOf(value.rubric), "Evaluator default")}
					error={issue("rubric")}
					hint="Falls back to evaluator.yaml → default_rubric."
					disabled={disabled}
					onChange={(t) => set("rubric", optionalText(t))}
				/>
			</FieldRow>
			<TextField
				label="Goal"
				multiline
				rows={2}
				value={textOf(value.goal)}
				error={issue("goal")}
				hint="What the simulated user wants, in one sentence."
				disabled={disabled}
				onChange={(t) => set("goal", t)}
			/>
			<TextField
				label="Intent"
				multiline
				rows={3}
				value={textOf(value.intent)}
				error={issue("intent")}
				hint="Why they want it and what they will not accept instead."
				disabled={disabled}
				onChange={(t) => set("intent", t)}
			/>
			<TextField
				label="Context"
				multiline
				rows={3}
				value={textOf(value.context)}
				error={issue("context")}
				hint="Preconditions and facts the user knows (customer number, dates…)."
				disabled={disabled}
				onChange={(t) => set("context", optionalText(t))}
			/>
			<TextField
				label="Success criteria"
				multiline
				rows={3}
				value={textOf(value.success_criteria)}
				error={issue("success_criteria")}
				hint="When the simulator should consider the goal reached; the judge reads it too."
				disabled={disabled}
				onChange={(t) => set("success_criteria", t)}
			/>
			<TextField
				label="Opening message example"
				value={textOf(value.opening_message_example)}
				error={issue("opening_message_example")}
				hint="Inspiration for the first message, never a script."
				disabled={disabled}
				onChange={(t) => set("opening_message_example", optionalText(t))}
			/>
			<LinesField
				label="Examples"
				items={stringList(value.examples)}
				error={issue("examples")}
				hint="More examples of how the user might phrase things, one per line."
				disabled={disabled}
				onChange={(items) => set("examples", items)}
			/>
			<FieldRow>
				<NumberField
					label="Max turns"
					value={numberOf(value.max_turns)}
					min={1}
					max={100}
					step={1}
					error={issue("max_turns")}
					hint="User → bot exchanges before the run fails."
					disabled={disabled}
					onChange={(n) => set("max_turns", n)}
				/>
				<NumberField
					label="Repeat"
					value={numberOf(value.repeat)}
					min={1}
					max={50}
					step={1}
					error={issue("repeat")}
					hint="Run N times to observe non-determinism."
					disabled={disabled}
					onChange={(n) => set("repeat", n)}
				/>
				<TagsField
					label="Tags"
					items={stringList(value.tags)}
					error={issue("tags")}
					disabled={disabled}
					onChange={(items) => set("tags", items)}
				/>
			</FieldRow>
			<CheckboxField
				label="Vision mode"
				hint="Also give the simulator screenshot-based (x/y) tools."
				checked={boolOf(value.vision)}
				disabled={disabled}
				onChange={(checked) => set("vision", checked)}
			/>
			<fieldset className="subsection">
				<legend>Expected artifacts</legend>
				{issue("expected_artifacts") ? (
					<p className="field__error" role="alert">
						{issue("expected_artifacts")}
					</p>
				) : null}
				{artifacts.length === 0 ? <p className="muted">None expected.</p> : null}
				{artifacts.map((artifact, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: artifacts have no identity of their own; the length suffix remounts rows on add/remove.
					<fieldset className="row-item" key={`${index}-${artifacts.length}`}>
						<legend>Artifact {index + 1}</legend>
						<FieldRow>
							<SelectField
								label="Type"
								value={textOf(artifact.type)}
								options={ARTIFACT_TYPES}
								error={issue(`expected_artifacts.${index}.type`)}
								disabled={disabled}
								onChange={(t) =>
									setArtifacts(artifacts.map((a, i) => (i === index ? setKey(a, "type", t) : a)))
								}
							/>
							<TextField
								label="MIME type"
								mono
								value={textOf(artifact.mime)}
								placeholder="application/pdf"
								error={issue(`expected_artifacts.${index}.mime`)}
								disabled={disabled}
								onChange={(t) =>
									setArtifacts(
										artifacts.map((a, i) => (i === index ? setKey(a, "mime", optionalText(t)) : a)),
									)
								}
							/>
							<TextField
								label="Description"
								value={textOf(artifact.description)}
								error={issue(`expected_artifacts.${index}.description`)}
								disabled={disabled}
								onChange={(t) =>
									setArtifacts(
										artifacts.map((a, i) =>
											i === index ? setKey(a, "description", optionalText(t)) : a,
										),
									)
								}
							/>
						</FieldRow>
						<Button
							size="sm"
							variant="ghost"
							disabled={disabled}
							onClick={() => setArtifacts(artifacts.filter((_, i) => i !== index))}
						>
							Remove artifact {index + 1}
						</Button>
					</fieldset>
				))}
				<Button
					size="sm"
					disabled={disabled}
					onClick={() => setArtifacts([...artifacts, { type: "download" }])}
				>
					Add artifact
				</Button>
			</fieldset>
		</>
	);
}

export function ScenarioEditor({ name }: { name: string }) {
	return (
		<ResourceEditor<Record_, Extras>
			collection="scenarios"
			kind="scenario"
			name={name}
			title="Scenarios"
			lead="Goal and intent are natural language; the simulator improvises the wording."
			codec={yamlCodec}
			toText={toYamlText}
			loadExtras={loadExtras}
			sourceLabel="YAML source"
			sourceHint="The file as it will be saved. Form edits regenerate it (comments are dropped)."
			nameOf={(v) => v.name}
			namePath="name"
		>
			{(editor, extras) => <ScenarioForm editor={editor} extras={extras} />}
		</ResourceEditor>
	);
}
