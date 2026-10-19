import type { PersonaDocument } from "@schemas/api";
import { FieldRow, NumberField, TagsField, TextField } from "../components/FormFields.js";
import type { DocumentEditor } from "../hooks/useDocumentEditor.js";
import { numberOf, optionalText, setKey, textOf } from "./fields.js";
import { issueFor } from "./issues.js";
import { stringList } from "./lists.js";
import { type PersonaDraft, personaCodec } from "./persona.js";
import { ResourceEditor } from "./ResourceEditor.js";

const BODY_HINT =
	"Free-form Markdown the simulator reads as the persona. Suggested sections: # Background, " +
	"# Goals & motivations, # Communication style, # Knowledge & experience, # Constraints.";

const toText = (doc: unknown): string => {
	const { frontmatter, body } = doc as PersonaDocument;
	return personaCodec.stringify({ frontmatter, body });
};

function PersonaForm({ editor }: { editor: DocumentEditor<PersonaDraft> }) {
	const value = editor.value;
	const disabled = value === undefined;
	const fm = value?.frontmatter ?? {};
	const issue = (path: string) => issueFor(editor.issues, path);
	const setFm = (key: string, next: unknown) =>
		editor.update((v) => ({ ...v, frontmatter: setKey(v.frontmatter, key, next) }));

	return (
		<>
			<FieldRow>
				<TextField
					label="Name"
					mono
					value={textOf(fm.name)}
					error={issue("frontmatter.name")}
					hint="Kebab-case slug; must equal the file name."
					disabled={disabled}
					onChange={(t) => setFm("name", t)}
				/>
				<TextField
					label="Language"
					value={textOf(fm.language)}
					error={issue("frontmatter.language")}
					hint="Language tag the persona speaks, e.g. en or pl."
					disabled={disabled}
					onChange={(t) => setFm("language", t)}
				/>
			</FieldRow>
			<TextField
				label="Description"
				value={textOf(fm.description)}
				error={issue("frontmatter.description")}
				hint="One sentence shown in lists and given to the judge."
				disabled={disabled}
				onChange={(t) => setFm("description", t)}
			/>
			<FieldRow>
				<TagsField
					label="Traits"
					items={stringList(fm.traits)}
					error={issue("frontmatter.traits")}
					hint="Short adjectives, comma-separated: impatient, non-technical."
					placeholder="impatient, direct"
					disabled={disabled}
					onChange={(items) => setFm("traits", items)}
				/>
				<TagsField
					label="Interaction style"
					items={stringList(fm.interaction_style)}
					error={issue("frontmatter.interaction_style")}
					hint="Behavioural modifiers the simulator applies: short-messages, occasional-typos."
					placeholder="short-messages"
					disabled={disabled}
					onChange={(items) => setFm("interaction_style", items)}
				/>
			</FieldRow>
			<NumberField
				label="Version"
				value={numberOf(fm.version)}
				min={1}
				step={1}
				error={issue("frontmatter.version")}
				disabled={disabled}
				onChange={(n) => setFm("version", n)}
			/>
			<TextField
				label="Body (Markdown)"
				multiline
				rows={16}
				value={value?.body ?? ""}
				error={issue("body")}
				hint={BODY_HINT}
				disabled={disabled}
				onChange={(t) => editor.update((v) => ({ ...v, body: optionalText(t) ?? "" }))}
			/>
		</>
	);
}

export function PersonaEditor({ name }: { name: string }) {
	return (
		<ResourceEditor<PersonaDraft, undefined>
			collection="personas"
			kind="persona"
			name={name}
			title="Personas"
			lead="Frontmatter on the left, the Markdown body below it; the source pane is the file as saved."
			codec={personaCodec}
			toText={toText}
			sourceLabel="Markdown source"
			sourceHint="YAML frontmatter between --- lines, then the Markdown body. Form edits regenerate this text."
			nameOf={(v) => v.frontmatter.name}
			namePath="frontmatter.name"
		>
			{(editor) => <PersonaForm editor={editor} />}
		</ResourceEditor>
	);
}
