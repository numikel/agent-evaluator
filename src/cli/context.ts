/**
 * Opens the workspace a command works on and resolves its settings with the P4 precedence
 * (file < environment < CLI flags). The returned workspace reports the resolved settings from
 * `loadSettings` and `resolve`, so env/CLI overrides reach the runner and the API.
 */
import { isAbsolute, join, resolve } from "node:path";
import { resolveSettings, type SettingsOverrides } from "../config/index.js";
import type { Settings } from "../schemas/index.js";
import { WORKSPACE_FILES } from "../workspace/index.js";
import type { RunStore, Workspace } from "../workspace/types.js";
import type { CliDeps } from "./deps.js";

export type OpenContextOptions = {
	/** `--workspace` value; relative to `deps.cwd`, defaults to it. */
	workspace?: string | undefined;
	/** Highest-precedence settings layer, from command flags. */
	overrides?: SettingsOverrides;
};

export type CliContext = {
	root: string;
	workspace: Workspace;
	runStore: RunStore;
	/** Settings as resolved when the context was opened. */
	settings: Settings;
	/** Re-reads the file and re-applies env/CLI layers (the API edits the file at runtime). */
	settingsLoader: () => Promise<Settings>;
};

function withSettings(base: Workspace, load: () => Promise<Settings>): Workspace {
	return {
		root: base.root,
		init: (options) => base.init(options),
		list: (kind) => base.list(kind),
		loadPersona: (name) => base.loadPersona(name),
		loadScenario: (name) => base.loadScenario(name),
		loadRubric: (name) => base.loadRubric(name),
		loadTarget: (name) => base.loadTarget(name),
		loadEvaluator: () => base.loadEvaluator(),
		loadSettings: load,
		readRaw: (kind, name) => base.readRaw(kind, name),
		writeRaw: (kind, content, name) => base.writeRaw(kind, content, name),
		remove: (kind, name) => base.remove(kind, name),
		validateRaw: (kind, content) => base.validateRaw(kind, content),
		resolve: async (name, overrides) => ({
			...(await base.resolve(name, overrides)),
			settings: await load(),
		}),
		template: (kind) => base.template(kind),
	};
}

export function workspaceRoot(deps: CliDeps, workspace: string | undefined): string {
	return resolve(deps.cwd, workspace ?? ".");
}

export async function openContext(
	deps: CliDeps,
	options: OpenContextOptions = {},
): Promise<CliContext> {
	const root = workspaceRoot(deps, options.workspace);
	const base = deps.openWorkspace(root);
	const settingsLoader = async (): Promise<Settings> =>
		resolveSettings({
			file: await base.loadSettings(),
			env: deps.env,
			...(options.overrides ? { cli: options.overrides } : {}),
			source: WORKSPACE_FILES.settings,
		});
	const settings = await settingsLoader();
	const runsDir = isAbsolute(settings.runs_dir) ? settings.runs_dir : join(root, settings.runs_dir);
	return {
		root,
		workspace: withSettings(base, settingsLoader),
		runStore: deps.openRunStore(runsDir),
		settings,
		settingsLoader,
	};
}
