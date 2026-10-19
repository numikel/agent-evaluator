import { useState } from "react";
import { Button } from "../components/Button.js";
import {
	CheckboxField,
	FieldRow,
	LinesField,
	NumberField,
	SelectField,
	TextField,
} from "../components/FormFields.js";
import { Panel } from "../components/Panel.js";
import type { DocumentEditor } from "../hooks/useDocumentEditor.js";
import { boolOf, listOf, numberOf, optionalText, recordOf, setKey, textOf } from "./fields.js";
import { issueFor } from "./issues.js";
import { stringList } from "./lists.js";
import { ResourceEditor } from "./ResourceEditor.js";
import {
	CRITERION_TYPES,
	type CriterionDraft,
	type CriterionType,
	criterionFields,
	type FieldSpec,
	isCriterionType,
	newCriterion,
	previewOutcome,
	retypeCriterion,
} from "./rubric.js";
import { type Record_, toYamlText, yamlCodec } from "./yaml.js";

const TYPE_OPTIONS = CRITERION_TYPES.map((t) => ({ value: t.type, label: t.label }));
const typeLabel = (type: unknown) =>
	CRITERION_TYPES.find((t) => t.type === type)?.label ?? `unknown type "${textOf(type)}"`;

const percent = (n: number) => `${Math.round(n * 100)}%`;

function TypedField({
	spec,
	criterion,
	path,
	disabled,
	issue,
	onChange,
}: {
	spec: FieldSpec;
	criterion: CriterionDraft;
	path: string;
	disabled: boolean;
	issue: (path: string) => string | undefined;
	onChange(key: string, value: unknown): void;
}) {
	const raw = criterion[spec.key];
	const common = {
		label: spec.label,
		hint: spec.hint,
		error: issue(`${path}.${spec.key}`),
		disabled,
	};
	switch (spec.kind) {
		case "number":
			return (
				<NumberField
					{...common}
					value={numberOf(raw)}
					min={0}
					step={1}
					onChange={(n) => onChange(spec.key, n)}
				/>
			);
		case "select": {
			const options = (spec.options ?? []).map((o) => ({ value: o, label: o }));
			const current = raw === undefined ? "" : String(raw);
			const isBool = spec.options?.every((o) => o === "true" || o === "false");
			return (
				<SelectField
					{...common}
					value={current}
					options={current === "" ? [{ value: "", label: "(default)" }, ...options] : options}
					onChange={(t) => onChange(spec.key, isBool ? t === "true" : t)}
				/>
			);
		}
		case "list":
			return (
				<LinesField
					{...common}
					items={stringList(raw)}
					onChange={(items) => onChange(spec.key, items)}
				/>
			);
		case "text":
			return (
				<TextField
					{...common}
					mono
					value={textOf(raw)}
					placeholder={spec.placeholder}
					onChange={(t) => onChange(spec.key, t)}
				/>
			);
	}
}

function CriterionItem({
	criterion,
	index,
	disabled,
	issue,
	onChange,
	onRemove,
}: {
	criterion: CriterionDraft;
	index: number;
	disabled: boolean;
	issue: (path: string) => string | undefined;
	onChange(next: CriterionDraft): void;
	onRemove(): void;
}) {
	const path = `criteria.${index}`;
	const id = textOf(criterion.id) || `#${index + 1}`;
	const set = (key: string, value: unknown) => onChange(setKey(criterion, key, value));
	return (
		<fieldset className="criterion">
			<legend className="criterion__legend">
				<span className="mono">{id}</span>
				<span className="muted"> · {typeLabel(criterion.type)}</span>
			</legend>
			{issue(path) && !criterionFields(textOf(criterion.type)).length ? (
				<p className="field__error" role="alert">
					{issue(path)}
				</p>
			) : null}
			<FieldRow>
				<TextField
					label="ID"
					mono
					value={textOf(criterion.id)}
					error={issue(`${path}.id`)}
					hint="snake_case or kebab-case; shown in the verdict."
					disabled={disabled}
					onChange={(t) => set("id", t)}
				/>
				<SelectField
					label="Type"
					value={isCriterionType(criterion.type) ? criterion.type : ""}
					options={
						isCriterionType(criterion.type)
							? TYPE_OPTIONS
							: [{ value: "", label: "(unknown)" }, ...TYPE_OPTIONS]
					}
					error={issue(`${path}.type`)}
					disabled={disabled}
					onChange={(t) => {
						if (isCriterionType(t)) onChange(retypeCriterion(criterion, t));
					}}
				/>
			</FieldRow>
			<TextField
				label="Description"
				multiline
				rows={2}
				value={textOf(criterion.description)}
				error={issue(`${path}.description`)}
				disabled={disabled}
				onChange={(t) => set("description", t)}
			/>
			<FieldRow>
				<NumberField
					label="Weight"
					value={numberOf(criterion.weight)}
					min={0}
					step={0.5}
					error={issue(`${path}.weight`)}
					disabled={disabled}
					onChange={(n) => set("weight", n)}
				/>
				<CheckboxField
					label="Required"
					hint="Failing it fails the run regardless of the score."
					checked={boolOf(criterion.required)}
					disabled={disabled}
					onChange={(checked) => set("required", checked)}
				/>
			</FieldRow>
			{criterionFields(textOf(criterion.type)).length > 0 ? (
				<FieldRow>
					{criterionFields(textOf(criterion.type)).map((spec) => (
						<TypedField
							key={spec.key}
							spec={spec}
							criterion={criterion}
							path={path}
							disabled={disabled}
							issue={issue}
							onChange={set}
						/>
					))}
				</FieldRow>
			) : null}
			<Button size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
				Remove {id}
			</Button>
		</fieldset>
	);
}

function RubricForm({ editor }: { editor: DocumentEditor<Record_> }) {
	const value = editor.value ?? {};
	const disabled = editor.value === undefined;
	const issue = (path: string) => issueFor(editor.issues, path);
	const set = (key: string, next: unknown) => editor.update((v) => setKey(v, key, next));
	const criteria = listOf(value.criteria).map((c) => recordOf(c) as CriterionDraft);
	const setCriteria = (next: CriterionDraft[]) => set("criteria", next);
	const [newType, setNewType] = useState<CriterionType>("llm");

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
			<NumberField
				label="Pass threshold"
				value={numberOf(value.pass_threshold)}
				min={0}
				max={1}
				step={0.05}
				error={issue("pass_threshold")}
				hint="Weighted score (0–1) required to pass; required criteria must pass on their own."
				disabled={disabled}
				onChange={(n) => set("pass_threshold", n)}
			/>
			<div className="subsection">
				<h3 className="subsection__title">Criteria</h3>
				{criteria.length === 0 ? (
					<p className="field__error" role="alert">
						{issue("criteria") ?? "At least one criterion is required."}
					</p>
				) : null}
				{criteria.map((criterion, index) => (
					<CriterionItem
						// biome-ignore lint/suspicious/noArrayIndexKey: criteria have no stable identity while edited (ids are user-typed and may collide); the length suffix remounts rows on add/remove.
						key={`${index}-${criteria.length}`}
						criterion={criterion}
						index={index}
						disabled={disabled}
						issue={issue}
						onChange={(next) => setCriteria(criteria.map((c, i) => (i === index ? next : c)))}
						onRemove={() => setCriteria(criteria.filter((_, i) => i !== index))}
					/>
				))}
				<div className="add-row">
					<SelectField
						label="New criterion type"
						value={newType}
						options={TYPE_OPTIONS}
						hint={CRITERION_TYPES.find((t) => t.type === newType)?.summary}
						disabled={disabled}
						onChange={(t) => {
							if (isCriterionType(t)) setNewType(t);
						}}
					/>
					<Button
						disabled={disabled}
						onClick={() => setCriteria([...criteria, newCriterion(newType, criteria.length)])}
					>
						Add criterion
					</Button>
				</div>
			</div>
		</>
	);
}

function ScorePreview({ editor }: { editor: DocumentEditor<Record_> }) {
	const [passing, setPassing] = useState<Record<string, boolean>>({});
	const value = editor.value ?? {};
	const criteria = listOf(value.criteria).map((c) => recordOf(c) as CriterionDraft);
	const threshold = numberOf(value.pass_threshold) ?? 0.7;
	const preview = previewOutcome(criteria, passing, threshold);

	return (
		<Panel title="Score preview" className="preview">
			<p className="muted">
				Tick which criteria pass to see the verdict the judge would compute. Score = Σ weight ×
				score ÷ Σ weight; a failing required criterion fails the run on its own.
			</p>
			<div className="table-wrap">
				<table className="table table--compact">
					<thead>
						<tr>
							<th scope="col">Passes</th>
							<th scope="col">Criterion</th>
							<th scope="col">Weight</th>
							<th scope="col">Share</th>
							<th scope="col">Required</th>
						</tr>
					</thead>
					<tbody>
						{preview.rows.map((row) => (
							<tr key={row.id} data-pass={row.pass}>
								<td>
									<input
										type="checkbox"
										aria-label={`${row.id} passes`}
										checked={row.pass}
										onChange={(e) => setPassing((p) => ({ ...p, [row.id]: e.target.checked }))}
									/>
								</td>
								<th scope="row">
									<span className="mono">{row.id}</span>
									{row.builtin ? <span className="tag">built-in</span> : null}
								</th>
								<td className="num">{row.weight}</td>
								<td className="num">{percent(row.share)}</td>
								<td>{row.required ? "yes" : "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="preview__summary">
				<span className="preview__score">{percent(preview.score)}</span>
				<span className="muted">
					{" "}
					of {preview.totalWeight} weight · threshold {percent(threshold)} ·{" "}
				</span>
				<span className="preview__status" data-status={preview.status}>
					{preview.status}
				</span>
				{preview.requiredFailed ? (
					<span className="muted"> (a required criterion fails)</span>
				) : null}
			</p>
		</Panel>
	);
}

export function RubricEditor({ name }: { name: string }) {
	return (
		<ResourceEditor<Record_, undefined>
			collection="rubrics"
			kind="rubric"
			name={name}
			title="Rubrics"
			lead="goal_reached (required, weight 3) is added automatically unless you define it."
			codec={yamlCodec}
			toText={toYamlText}
			sourceLabel="YAML source"
			sourceHint="The file as it will be saved. Form edits regenerate it (comments are dropped)."
			nameOf={(v) => v.name}
			namePath="name"
			aside={(editor) => <ScorePreview editor={editor} />}
		>
			{(editor) => <RubricForm editor={editor} />}
		</ResourceEditor>
	);
}
