/**
 * Settings: per role a provider → model → effort cascade fed by `GET /api/providers` (configured
 * only) and `GET /api/providers/:id/models`; browser and run options; `PUT /api/settings` as JSON.
 */
import type { ModelInfo, ProviderModelsResponse, ProviderStatus } from "@schemas/api";
import { EFFORT_LEVELS, MODEL_ROLES, type ModelRole } from "@schemas/settings";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiValidationError, endpoints } from "../api/client.js";
import { Button } from "../components/Button.js";
import {
	CheckboxField,
	FieldRow,
	NumberField,
	SelectField,
	type SelectOption,
	TextField,
} from "../components/FormFields.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";
import { TemplateActions } from "../components/TemplateActions.js";
import type { Issue } from "../editors/issues.js";
import { issueFor } from "../editors/issues.js";
import { buildSettings, type RoleDraft, type SettingsDraft, toDraft } from "../editors/settings.js";
import { errorMessage, useAsync } from "../hooks/useAsync.js";

const README_SECRETS = "https://github.com/numikel/agent-evaluator#secrets";
const INSTALL_COMMAND = "npx playwright install chromium";
const OTHER = "__other__";

const ROLE_INFO: Record<ModelRole, { label: string; hint: string; optional: boolean }> = {
	simulator: {
		label: "Simulator",
		hint: "Drives the browser as the persona. Needs tool calling; vision mode needs image input.",
		optional: false,
	},
	judge: {
		label: "Judge",
		hint: "Scores the run against the rubric from the transcript and screenshots.",
		optional: false,
	},
	evidence_selector: {
		label: "Evidence selector",
		hint: "Picks the key screenshots for the judge. Leave empty to reuse the judge model.",
		optional: true,
	},
};

const EFFORT_HINT =
	"Provider-agnostic reasoning effort, mapped to each provider's own knob (OpenAI reasoning " +
	"effort, Anthropic thinking budget, Gemini thinking config, Groq, Ollama think); providers " +
	"without one ignore it.";

type ModelsState =
	| { status: "loading" }
	| { status: "ready"; data: ProviderModelsResponse }
	| { status: "error"; message: string };

const fmt = (n: number) => n.toLocaleString("en-US");
const yesNo = (v: boolean | undefined) => (v === undefined ? "unknown" : v ? "yes" : "no");

function ModelCard({ model }: { model: ModelInfo }) {
	const known =
		model.context_window !== undefined ||
		model.max_output_tokens !== undefined ||
		model.supports_images !== undefined ||
		model.supports_reasoning !== undefined;
	return (
		<dl className="model-card" aria-label={`${model.label} details`}>
			<div>
				<dt>Reference</dt>
				<dd className="mono">{model.ref}</dd>
			</div>
			{known ? (
				<>
					<div>
						<dt>Context window</dt>
						<dd>{model.context_window === undefined ? "unknown" : fmt(model.context_window)}</dd>
					</div>
					<div>
						<dt>Max output</dt>
						<dd>
							{model.max_output_tokens === undefined ? "unknown" : fmt(model.max_output_tokens)}
						</dd>
					</div>
					<div>
						<dt>Images</dt>
						<dd>{yesNo(model.supports_images)}</dd>
					</div>
					<div>
						<dt>Reasoning</dt>
						<dd>{yesNo(model.supports_reasoning)}</dd>
					</div>
				</>
			) : (
				<div>
					<dt>Details</dt>
					<dd className="muted">not reported by the provider</dd>
				</div>
			)}
		</dl>
	);
}

type RolePickerProps = {
	role: ModelRole;
	draft: RoleDraft;
	providers: ProviderStatus[];
	models: ModelsState | undefined;
	issues: Issue[];
	onChange(next: RoleDraft): void;
	onRefresh(providerId: string): void;
};

function RolePicker({
	role,
	draft,
	providers,
	models,
	issues,
	onChange,
	onRefresh,
}: RolePickerProps) {
	const info = ROLE_INFO[role];
	const [other, setOther] = useState(false);
	const configured = providers.some((p) => p.id === draft.provider);
	const providerOptions: SelectOption[] = [
		...(info.optional ? [{ value: "", label: "Same as judge" }] : []),
		...providers.map((p) => ({ value: p.id, label: p.label })),
	];
	if (draft.provider !== "" && !configured) {
		providerOptions.push({ value: draft.provider, label: `${draft.provider} (not configured)` });
	}
	const list = models?.status === "ready" ? models.data.models : [];
	const inList = list.some((m) => m.id === draft.model);
	const useOther = other || (models?.status === "ready" && !inList && draft.model !== "");
	const modelOptions: SelectOption[] = [
		{ value: "", label: models?.status === "loading" ? "Loading models…" : "Choose a model" },
		...list.map((m) => ({ value: m.id, label: m.label === m.id ? m.id : `${m.label} (${m.id})` })),
		{ value: OTHER, label: "Other model id…" },
	];
	const selected = list.find((m) => m.id === draft.model);
	const effortOptions: SelectOption[] = [
		{ value: "", label: "Provider default" },
		...EFFORT_LEVELS.map((e) => ({ value: e, label: e })),
	];
	const unset = draft.provider === "";

	return (
		<fieldset className="role">
			<legend>{info.label}</legend>
			<p className="muted role__hint">{info.hint}</p>
			<FieldRow>
				<SelectField
					label="Provider"
					value={draft.provider}
					options={providerOptions}
					error={issueFor(issues, `models.${role}`)}
					onChange={(provider) => {
						setOther(false);
						onChange({ ...draft, provider, model: "" });
					}}
				/>
				<SelectField
					label="Model"
					value={useOther ? OTHER : draft.model}
					options={modelOptions}
					disabled={unset || models?.status === "loading"}
					onChange={(model) => {
						if (model === OTHER) {
							setOther(true);
							return;
						}
						setOther(false);
						onChange({ ...draft, model });
					}}
				/>
			</FieldRow>
			{useOther && !unset ? (
				<TextField
					label="Model id"
					mono
					value={draft.model}
					hint="Typed as the provider expects it; stored as provider:model."
					onChange={(model) => onChange({ ...draft, model })}
				/>
			) : null}
			{!unset ? (
				<div className="models-meta">
					{models?.status === "ready" && models.data.source === "fallback" ? (
						<p className="notice notice--warn">
							Fallback list: the provider did not return a live model list
							{models.data.error ? ` (${models.data.error})` : ""}. Model ids may be incomplete or
							outdated; use "Other model id…" if yours is missing.
						</p>
					) : null}
					{models?.status === "error" ? (
						<p className="notice notice--error" role="alert">
							Could not load models: {models.message}
						</p>
					) : null}
					<Button
						size="sm"
						onClick={() => onRefresh(draft.provider)}
						disabled={models?.status === "loading"}
					>
						Refresh models
					</Button>
				</div>
			) : null}
			{selected ? <ModelCard model={selected} /> : null}
			<FieldRow>
				<SelectField
					label="Effort"
					value={draft.effort}
					options={effortOptions}
					hint={EFFORT_HINT}
					error={issueFor(issues, `effort.${role}`)}
					disabled={unset}
					onChange={(effort) => onChange({ ...draft, effort })}
				/>
				<NumberField
					label="Temperature"
					value={draft.temperature === "" ? undefined : Number(draft.temperature)}
					min={0}
					max={2}
					step={0.1}
					placeholder="provider default"
					hint="Optional, 0–2. Some providers reject a custom temperature when reasoning is on."
					error={issueFor(issues, `temperature.${role}`)}
					disabled={unset}
					onChange={(n) => onChange({ ...draft, temperature: n === undefined ? "" : String(n) })}
				/>
			</FieldRow>
		</fieldset>
	);
}

type SaveState =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "saved" }
	| { kind: "error"; message: string };

function SettingsForm({
	initial,
	providers,
	presence,
	browserInstalled,
}: {
	initial: SettingsDraft;
	providers: ProviderStatus[];
	presence: ProviderStatus[];
	browserInstalled: boolean;
}) {
	const [draft, setDraft] = useState(initial);
	const [models, setModels] = useState<Record<string, ModelsState>>({});
	const [save, setSave] = useState<SaveState>({ kind: "idle" });
	const [issues, setIssues] = useState<Issue[]>([]);
	const requested = useRef(new Set<string>());

	const loadModels = useCallback(
		(id: string, refresh = false) => {
			if (!providers.some((p) => p.id === id)) return;
			setModels((m) => ({ ...m, [id]: { status: "loading" } }));
			endpoints.providerModels(id, { refresh }).then(
				(data) => setModels((m) => ({ ...m, [id]: { status: "ready", data } })),
				(error: unknown) =>
					setModels((m) => ({ ...m, [id]: { status: "error", message: errorMessage(error) } })),
			);
		},
		[providers],
	);

	const needed = MODEL_ROLES.map((role) => draft.roles[role].provider).filter((p) => p !== "");
	const neededKey = [...new Set(needed)].sort().join(",");
	useEffect(() => {
		for (const id of neededKey.split(",").filter(Boolean)) {
			if (requested.current.has(id)) continue;
			requested.current.add(id);
			loadModels(id);
		}
	}, [neededKey, loadModels]);

	const setRole = (role: ModelRole, next: RoleDraft) => {
		setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s));
		setDraft((d) => ({ ...d, roles: { ...d.roles, [role]: next } }));
	};

	const submit = async () => {
		setSave({ kind: "saving" });
		setIssues([]);
		try {
			const response = await endpoints.saveSettings(buildSettings(draft));
			setDraft(toDraft(response.settings));
			setSave({ kind: "saved" });
		} catch (error) {
			if (error instanceof ApiValidationError) setIssues(error.issues);
			setSave({ kind: "error", message: `Save failed: ${errorMessage(error)}` });
		}
	};

	const statusText =
		save.kind === "saving"
			? "Saving…"
			: save.kind === "saved"
				? "Saved."
				: save.kind === "error"
					? save.message
					: "";

	return (
		<>
			<PageHeader
				title="Settings"
				lead="Models per role, browser options and the runs directory. API keys stay in your environment."
				actions={
					<>
						<TemplateActions kind="settings" />
						<Button
							variant="primary"
							onClick={() => void submit()}
							disabled={save.kind === "saving"}
						>
							Save settings
						</Button>
					</>
				}
			/>
			<p
				className={`editor__status${save.kind === "error" ? " editor__status--error" : ""}`}
				role="status"
				aria-live="polite"
			>
				{statusText}
			</p>
			{!browserInstalled ? (
				<p className="notice notice--warn" role="alert">
					Chromium is not installed, so runs cannot start. Install it with{" "}
					<code className="mono">{INSTALL_COMMAND}</code> and restart the server.
				</p>
			) : null}
			{issues.length > 0 ? (
				<section className="issues" aria-labelledby="settings-issues-title">
					<h2 id="settings-issues-title" className="issues__title">
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
			{providers.length === 0 ? (
				<Panel title="Providers">
					<div className="empty">
						<p>
							No provider is configured: no API key was found in the environment when the server
							started. Set one of these variables and restart:
						</p>
						<ul className="env-list">
							{presence.map((p) => (
								<li key={p.id}>
									<code className="mono">{p.env}</code> <span className="muted">→ {p.label}</span>
								</li>
							))}
						</ul>
						<p>
							Keys are never written to disk by the tool. Inject them with{" "}
							<code className="mono">dotenvx run --</code>, <code className="mono">op run --</code>{" "}
							(1Password CLI), direnv + sops, or your CI secrets; see{" "}
							<a href={README_SECRETS} target="_blank" rel="noreferrer">
								README → Secrets
							</a>
							.
						</p>
					</div>
				</Panel>
			) : null}
			<Panel title="Models">
				<div className="roles">
					{MODEL_ROLES.map((role) => (
						<RolePicker
							key={role}
							role={role}
							draft={draft.roles[role]}
							providers={providers}
							models={models[draft.roles[role].provider]}
							issues={issues}
							onChange={(next) => setRole(role, next)}
							onRefresh={(id) => loadModels(id, true)}
						/>
					))}
				</div>
			</Panel>
			<Panel title="Browser and runs">
				<CheckboxField
					label="Headless browser"
					hint="Uncheck to watch runs in a visible Chromium window."
					checked={draft.browser.headless}
					onChange={(headless) => setDraft((d) => ({ ...d, browser: { ...d.browser, headless } }))}
				/>
				<FieldRow>
					<NumberField
						label="Slow motion (ms)"
						value={draft.browser.slow_mo_ms === "" ? undefined : Number(draft.browser.slow_mo_ms)}
						min={0}
						step={50}
						hint="Delay between browser actions; useful when watching."
						error={issueFor(issues, "browser.slow_mo_ms")}
						onChange={(n) =>
							setDraft((d) => ({
								...d,
								browser: { ...d.browser, slow_mo_ms: n === undefined ? "" : String(n) },
							}))
						}
					/>
					<NumberField
						label="Concurrency"
						value={draft.concurrency === "" ? undefined : Number(draft.concurrency)}
						min={1}
						max={16}
						step={1}
						hint="Scenarios executed in parallel browser contexts (1–16)."
						error={issueFor(issues, "concurrency")}
						onChange={(n) =>
							setDraft((d) => ({ ...d, concurrency: n === undefined ? "" : String(n) }))
						}
					/>
					<TextField
						label="Runs directory"
						mono
						value={draft.runs_dir}
						hint="Relative to the workspace root."
						error={issueFor(issues, "runs_dir")}
						onChange={(runs_dir) => setDraft((d) => ({ ...d, runs_dir }))}
					/>
				</FieldRow>
				<p className="muted">
					Server host and port (
					<code className="mono">
						{draft.server.host}:{draft.server.port}
					</code>
					) are kept as they are; change them in <code className="mono">agent-evaluator.yaml</code>.
				</p>
			</Panel>
		</>
	);
}

export function SettingsPage() {
	const load = useAsync(
		() => Promise.all([endpoints.settings(), endpoints.providers()]),
		"settings",
	);
	return (
		<div data-testid="page-settings">
			{load.status === "loading" ? (
				<p className="muted">Loading…</p>
			) : load.status === "error" ? (
				<p className="inline-error" role="alert">
					Could not load settings: {load.message}
				</p>
			) : (
				<SettingsForm
					initial={toDraft(load.data[0].settings)}
					providers={load.data[1].filter((p) => p.configured)}
					presence={load.data[0].providers}
					browserInstalled={load.data[0].browser_installed}
				/>
			)}
		</div>
	);
}
