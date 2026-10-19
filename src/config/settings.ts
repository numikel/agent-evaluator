import {
	type Effort,
	MODEL_REF_PATTERN,
	type ModelRole,
	parseOrThrow,
	type Settings,
	SettingsSchema,
	ValidationError,
	type ValidationIssue,
} from "../schemas/index.js";

/** Environment variables that override `agent-evaluator.yaml`. */
export const SETTINGS_ENV_VARS = [
	"AE_PORT",
	"AE_RUNS_DIR",
	"AE_HEADLESS",
	"AE_MODEL_SIMULATOR",
	"AE_MODEL_JUDGE",
] as const;

/** Partial settings, as the CLI passes them (`--port`, `--headed`, ...). */
export type SettingsOverrides = {
	models?: Partial<Record<ModelRole, string>>;
	temperature?: Partial<Record<ModelRole, number>>;
	effort?: Partial<Record<ModelRole, Effort>>;
	browser?: { headless?: boolean; slow_mo_ms?: number };
	concurrency?: number;
	runs_dir?: string;
	server?: { port?: number; host?: string };
};

export type ResolveSettingsOptions = {
	/** Parsed content of `agent-evaluator.yaml` (lowest precedence); undefined when the file is absent. */
	file?: unknown;
	/** Defaults to `process.env`. */
	env?: Record<string, string | undefined>;
	/** Highest precedence. */
	cli?: SettingsOverrides;
	/** Name reported in validation errors for the file layer (e.g. the file path). */
	source?: string;
};

type Layer = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Layer =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merges plain objects; `undefined` values in `over` do not erase values from `base`. */
function merge(base: Layer, over: Layer): Layer {
	const out: Layer = { ...base };
	for (const [key, value] of Object.entries(over)) {
		if (value === undefined) continue;
		const existing = out[key];
		out[key] = isPlainObject(existing) && isPlainObject(value) ? merge(existing, value) : value;
	}
	return out;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function envLayer(env: Record<string, string | undefined>): Layer {
	const issues: ValidationIssue[] = [];
	const layer: Layer = {};
	const value = (name: (typeof SETTINGS_ENV_VARS)[number]): string | undefined => {
		const raw = env[name]?.trim();
		return raw ? raw : undefined;
	};

	const port = value("AE_PORT");
	if (port !== undefined) {
		if (/^\d+$/.test(port)) layer.server = { port: Number.parseInt(port, 10) };
		else issues.push({ path: "AE_PORT", message: "must be an integer" });
	}

	const runsDir = value("AE_RUNS_DIR");
	if (runsDir !== undefined) layer.runs_dir = runsDir;

	const headless = value("AE_HEADLESS");
	if (headless !== undefined) {
		const lower = headless.toLowerCase();
		if (TRUE_VALUES.has(lower)) layer.browser = { headless: true };
		else if (FALSE_VALUES.has(lower)) layer.browser = { headless: false };
		else issues.push({ path: "AE_HEADLESS", message: "must be true/false (1/0, yes/no, on/off)" });
	}

	const models: Layer = {};
	for (const [name, role] of [
		["AE_MODEL_SIMULATOR", "simulator"],
		["AE_MODEL_JUDGE", "judge"],
	] as const) {
		const ref = value(name);
		if (ref === undefined) continue;
		if (MODEL_REF_PATTERN.test(ref)) models[role] = ref;
		else issues.push({ path: name, message: "must be an explicit 'provider:model' reference" });
	}
	if (Object.keys(models).length > 0) layer.models = models;

	if (issues.length > 0) throw new ValidationError("environment", issues);
	return layer;
}

/**
 * Resolves workspace settings with precedence file < environment < CLI and validates the result
 * against `SettingsSchema`. Throws `ValidationError` (source `environment` for bad env values).
 */
export function resolveSettings(options: ResolveSettingsOptions = {}): Settings {
	const source = options.source ?? "settings";
	let file: Layer = {};
	if (options.file !== undefined && options.file !== null) {
		if (!isPlainObject(options.file)) {
			throw new ValidationError(source, [{ path: "", message: "settings must be a mapping" }]);
		}
		file = options.file;
	}
	const merged = merge(
		merge(file, envLayer(options.env ?? process.env)),
		(options.cli ?? {}) as Layer,
	);
	return parseOrThrow(SettingsSchema, merged, source);
}
