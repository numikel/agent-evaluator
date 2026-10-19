import {
	CheckboxField,
	FieldRow,
	LinesField,
	NumberField,
	TextField,
} from "../components/FormFields.js";
import type { DocumentEditor } from "../hooks/useDocumentEditor.js";
import { boolOf, numberOf, optionalText, recordOf, setKey, setPath, textOf } from "./fields.js";
import { issueFor } from "./issues.js";
import { stringList } from "./lists.js";
import { ResourceEditor } from "./ResourceEditor.js";
import { type Record_, toYamlText, yamlCodec } from "./yaml.js";

const TIMEOUTS: readonly { key: string; label: string; hint: string }[] = [
	{
		key: "response_ms",
		label: "Response timeout (ms)",
		hint: "Max wait for a reply to start and settle.",
	},
	{
		key: "stable_ms",
		label: "Stable period (ms)",
		hint: "Reply is complete when unchanged this long.",
	},
	{ key: "navigation_ms", label: "Navigation timeout (ms)", hint: "Page loads and redirects." },
	{
		key: "capture_interval_ms",
		label: "Capture interval (ms)",
		hint: "Interim evidence screenshots while waiting.",
	},
];

function TargetForm({ editor }: { editor: DocumentEditor<Record_> }) {
	const value = editor.value ?? {};
	const disabled = editor.value === undefined;
	const issue = (path: string) => issueFor(editor.issues, path);
	const set = (key: string, next: unknown) => editor.update((v) => setKey(v, key, next));
	const setNested = (path: string[], next: unknown) => editor.update((v) => setPath(v, path, next));
	const timeouts = recordOf(value.timeouts);
	const viewport = recordOf(value.viewport);
	const auth = recordOf(value.auth);
	const credentials = recordOf(auth.credentials_env);

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
			<TextField
				label="URL"
				type="url"
				mono
				value={textOf(value.url)}
				error={issue("url")}
				hint="http(s) address of the page with the chat; the simulator finds the widget itself."
				placeholder="https://example.com/support"
				disabled={disabled}
				onChange={(t) => set("url", t)}
			/>
			<LinesField
				label="Hints"
				items={stringList(value.hints)}
				error={issue("hints")}
				hint="Natural-language help for tricky interfaces, one per line."
				placeholder="The chat opens after clicking the bubble bottom-right."
				disabled={disabled}
				onChange={(items) => set("hints", items)}
			/>
			<fieldset className="subsection">
				<legend>Timeouts</legend>
				<FieldRow>
					{TIMEOUTS.map((t) => (
						<NumberField
							key={t.key}
							label={t.label}
							value={numberOf(timeouts[t.key])}
							min={1}
							step={100}
							hint={t.hint}
							error={issue(`timeouts.${t.key}`)}
							disabled={disabled}
							onChange={(n) => setNested(["timeouts", t.key], n)}
						/>
					))}
				</FieldRow>
			</fieldset>
			<fieldset className="subsection">
				<legend>Browser</legend>
				<FieldRow>
					<NumberField
						label="Viewport width"
						value={numberOf(viewport.width)}
						min={320}
						step={1}
						error={issue("viewport.width")}
						disabled={disabled}
						onChange={(n) => setNested(["viewport", "width"], n)}
					/>
					<NumberField
						label="Viewport height"
						value={numberOf(viewport.height)}
						min={320}
						step={1}
						error={issue("viewport.height")}
						disabled={disabled}
						onChange={(n) => setNested(["viewport", "height"], n)}
					/>
				</FieldRow>
				<CheckboxField
					label="Headless"
					hint="Uncheck to watch the browser while a run executes."
					checked={value.headless === undefined ? true : boolOf(value.headless)}
					disabled={disabled}
					onChange={(checked) => set("headless", checked)}
				/>
				<CheckboxField
					label="Vision mode"
					hint="Enable screenshot/x-y tools for canvas-heavy UIs."
					checked={boolOf(value.vision)}
					disabled={disabled}
					onChange={(checked) => set("vision", checked)}
				/>
			</fieldset>
			<fieldset className="subsection">
				<legend>Authentication</legend>
				<p className="muted">
					All optional. Credential values never live in this file: name the environment variables
					that hold them.
				</p>
				<TextField
					label="Storage state file"
					mono
					value={textOf(auth.storage_state)}
					error={issue("auth.storage_state")}
					hint="Path to a Playwright storageState JSON captured beforehand."
					placeholder="./auth/demo.json"
					disabled={disabled}
					onChange={(t) => setNested(["auth", "storage_state"], optionalText(t))}
				/>
				<TextField
					label="Login steps"
					multiline
					rows={3}
					value={textOf(auth.login_steps)}
					error={issue("auth.login_steps")}
					hint="Natural-language instructions the simulator follows before the conversation."
					disabled={disabled}
					onChange={(t) => setNested(["auth", "login_steps"], optionalText(t))}
				/>
				<FieldRow>
					<TextField
						label="Username env var"
						mono
						value={textOf(credentials.username)}
						error={issue("auth.credentials_env.username")}
						placeholder="DEMO_USER"
						disabled={disabled}
						onChange={(t) => setNested(["auth", "credentials_env", "username"], optionalText(t))}
					/>
					<TextField
						label="Password env var"
						mono
						value={textOf(credentials.password)}
						error={issue("auth.credentials_env.password")}
						placeholder="DEMO_PASSWORD"
						disabled={disabled}
						onChange={(t) => setNested(["auth", "credentials_env", "password"], optionalText(t))}
					/>
				</FieldRow>
			</fieldset>
		</>
	);
}

export function TargetEditor({ name }: { name: string }) {
	return (
		<ResourceEditor<Record_, undefined>
			collection="targets"
			kind="target"
			name={name}
			title="Targets"
			lead="Only the URL is required; everything else helps the simulator with tricky UIs."
			codec={yamlCodec}
			toText={toYamlText}
			sourceLabel="YAML source"
			sourceHint="The file as it will be saved. Form edits regenerate it (comments are dropped)."
			nameOf={(v) => v.name}
			namePath="name"
		>
			{(editor) => <TargetForm editor={editor} />}
		</ResourceEditor>
	);
}
