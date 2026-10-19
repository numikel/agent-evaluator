/**
 * Settings form draft ⇄ `Settings` DTO. The draft keeps every input as a string so empty
 * fields mean "omit" (the schema treats omitted temperature/effort as provider defaults).
 */
import { MODEL_ROLES, type ModelRole, type Settings } from "@schemas/settings";

export type RoleDraft = {
	provider: string;
	model: string;
	/** `""` = provider default. */
	effort: string;
	/** `""` = not sent. */
	temperature: string;
};

export type SettingsDraft = {
	roles: Record<ModelRole, RoleDraft>;
	browser: { headless: boolean; slow_mo_ms: string };
	concurrency: string;
	runs_dir: string;
	server: Settings["server"];
};

export function parseModelRef(ref: string | undefined): { provider: string; model: string } {
	if (!ref) return { provider: "", model: "" };
	const idx = ref.indexOf(":");
	if (idx < 0) return { provider: "", model: ref };
	return { provider: ref.slice(0, idx), model: ref.slice(idx + 1) };
}

export function toDraft(settings: Settings): SettingsDraft {
	const roles = {} as Record<ModelRole, RoleDraft>;
	for (const role of MODEL_ROLES) {
		const { provider, model } = parseModelRef(settings.models[role]);
		const temperature = settings.temperature?.[role];
		roles[role] = {
			provider,
			model,
			effort: settings.effort?.[role] ?? "",
			temperature: temperature === undefined ? "" : String(temperature),
		};
	}
	return {
		roles,
		browser: {
			headless: settings.browser.headless,
			slow_mo_ms: String(settings.browser.slow_mo_ms),
		},
		concurrency: String(settings.concurrency),
		runs_dir: settings.runs_dir,
		server: settings.server,
	};
}

const asNumber = (text: string, fallback: number): number => {
	const n = Number(text);
	return text.trim() === "" || !Number.isFinite(n) ? fallback : n;
};

const modelRef = (role: RoleDraft): string =>
	role.provider && role.model ? `${role.provider}:${role.model}` : role.model;

/** Builds the PUT body; optional sections appear only when at least one role sets them. */
export function buildSettings(draft: SettingsDraft): Settings {
	const models: Settings["models"] = {
		simulator: modelRef(draft.roles.simulator),
		judge: modelRef(draft.roles.judge),
	};
	const selector = modelRef(draft.roles.evidence_selector);
	if (selector) models.evidence_selector = selector;

	const effort: NonNullable<Settings["effort"]> = {};
	const temperature: NonNullable<Settings["temperature"]> = {};
	for (const role of MODEL_ROLES) {
		const r = draft.roles[role];
		if (r.effort) effort[role] = r.effort as NonNullable<Settings["effort"]>[ModelRole];
		if (r.temperature.trim() !== "" && Number.isFinite(Number(r.temperature))) {
			temperature[role] = Number(r.temperature);
		}
	}

	const settings: Settings = {
		models,
		browser: {
			headless: draft.browser.headless,
			slow_mo_ms: asNumber(draft.browser.slow_mo_ms, 0),
		},
		concurrency: asNumber(draft.concurrency, 1),
		runs_dir: draft.runs_dir,
		server: draft.server,
	};
	if (Object.keys(effort).length > 0) settings.effort = effort;
	if (Object.keys(temperature).length > 0) settings.temperature = temperature;
	return settings;
}
