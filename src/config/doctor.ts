import { existsSync } from "node:fs";
import { join } from "node:path";
import { MODEL_ROLES, type ModelRole, type Settings } from "../schemas/index.js";
import { WORKSPACE_DIRS, WORKSPACE_FILES } from "../workspace/types.js";
import { createProviderRegistry, DEFAULT_OLLAMA_BASE_URL, parseRef } from "./providers.js";
import type {
	DoctorCheck,
	ProviderDefinition,
	ProviderRegistry,
	SecretsProvider,
} from "./types.js";

export const CHROMIUM_INSTALL_HINT = "npx playwright install chromium";
export const TARGET_PROBE_TIMEOUT_MS = 3000;

/** A target the doctor probes with one `GET`: the workspace's `targets/<name>.yaml`. */
export type TargetProbe = { name: string; url: string };

export type DoctorOptions = {
	secrets: SecretsProvider;
	settings: Settings;
	workspaceRoot: string;
	registry?: ProviderRegistry;
	/** Injected for tests; defaults to `fs.existsSync`. */
	exists?: (path: string) => boolean;
	/** Injected for tests; defaults to Playwright's `chromium.executablePath()`. */
	chromiumExecutablePath?: () => string | Promise<string>;
	/** Targets to probe for reachability (informational, never blocking). Defaults to none. */
	targets?: TargetProbe[];
	/** Injected for tests; defaults to the global `fetch`. */
	fetch?: typeof fetch;
	/** Per-target probe timeout; defaults to `TARGET_PROBE_TIMEOUT_MS`. */
	targetTimeoutMs?: number;
};

const defaultChromiumPath = async (): Promise<string> => {
	const { chromium } = await import("playwright");
	return chromium.executablePath();
};

const exportHint = (def: ProviderDefinition): string =>
	def.id === "ollama"
		? `export ${def.env}=${DEFAULT_OLLAMA_BASE_URL}`
		: `export ${def.env}=<your key> (or inject it with dotenvx / op run / sops, see README "Secrets")`;

function providerChecks(registry: ProviderRegistry, secrets: SecretsProvider): DoctorCheck[] {
	return registry.all().map((def) => {
		const ok = secrets.has(def.env);
		return {
			id: `provider:${def.id}`,
			label: `${def.label} (${def.env})`,
			ok,
			detail: ok ? `${def.env} is set` : `${def.env} is not set`,
			...(ok ? {} : { fix: exportHint(def) }),
		};
	});
}

async function browserCheck(
	options: DoctorOptions,
	exists: (p: string) => boolean,
): Promise<DoctorCheck> {
	const id = "browser:chromium";
	const label = "Chromium for Playwright";
	try {
		const path = await (options.chromiumExecutablePath ?? defaultChromiumPath)();
		const ok = path.length > 0 && exists(path);
		return {
			id,
			label,
			ok,
			detail: ok ? `found at ${path}` : `not found at ${path}`,
			...(ok ? {} : { fix: CHROMIUM_INSTALL_HINT }),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			id,
			label,
			ok: false,
			detail: `Playwright could not resolve Chromium: ${message}`,
			fix: CHROMIUM_INSTALL_HINT,
		};
	}
}

function workspaceChecks(root: string, exists: (p: string) => boolean): DoctorCheck[] {
	const entries: [string, string, string][] = [
		["settings", WORKSPACE_FILES.settings, "settings file"],
		["evaluator", WORKSPACE_FILES.evaluator, "evaluator config"],
		...Object.entries(WORKSPACE_DIRS).map(([key, dir]): [string, string, string] => [
			key,
			dir,
			`${key} directory`,
		]),
	];
	return entries.map(([key, relative, what]) => {
		const path = join(root, relative);
		const ok = exists(path);
		return {
			id: `workspace:${key}`,
			label: `Workspace ${what}`,
			ok,
			detail: ok ? `${path} present` : `${path} missing`,
			...(ok ? {} : { fix: `run \`agent-evaluator init\` in ${root}` }),
		};
	});
}

function modelChecks(
	settings: Settings,
	registry: ProviderRegistry,
	secrets: SecretsProvider,
): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	const supported = registry
		.all()
		.map((p) => p.id)
		.join(", ");
	for (const role of MODEL_ROLES satisfies readonly ModelRole[]) {
		const ref = settings.models[role];
		if (ref === undefined) continue; // evidence_selector falls back to the judge
		const id = `model:${role}`;
		const label = `${role} model`;
		let provider: string;
		try {
			provider = parseRef(ref).provider;
		} catch {
			checks.push({
				id,
				label,
				ok: false,
				detail: `${ref} is not a 'provider:model' reference`,
				fix: `set models.${role} to e.g. anthropic:claude-sonnet-5-5`,
			});
			continue;
		}
		const def = registry.all().find((p) => p.id === provider);
		if (!def) {
			checks.push({
				id,
				label,
				ok: false,
				detail: `${ref} refers to unknown provider '${provider}'`,
				fix: `use one of: ${supported}`,
			});
			continue;
		}
		const ok = secrets.has(def.env);
		checks.push({
			id,
			label,
			ok,
			detail: ok ? `${ref} (${def.env} is set)` : `${ref} needs ${def.env}, which is not set`,
			...(ok ? {} : { fix: exportHint(def) }),
		});
	}
	return checks;
}

const targetFixHint = (name: string): string =>
	`start the chatbot (for the built-in demo: \`agent-evaluator demo\` in another terminal) or fix targets/${name}.yaml`;

/** `fetch failed` hides the useful part (`ECONNREFUSED`) in `cause`; timeouts are DOMExceptions. */
function probeFailureReason(error: unknown): string {
	if (error instanceof Error) {
		const cause = error.cause;
		if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
			return cause.code;
		}
		if (error.name === "TimeoutError") return "timed out";
		return error.message;
	}
	return String(error);
}

/**
 * One `GET` per target. Any HTTP response (even 4xx/5xx) means something listens at the URL, which
 * is all a run needs to start; a connection error or timeout is reported with the reason.
 */
async function targetChecks(
	targets: TargetProbe[],
	fetchFn: typeof fetch,
	timeoutMs: number,
): Promise<DoctorCheck[]> {
	return Promise.all(
		targets.map(async ({ name, url }): Promise<DoctorCheck> => {
			const id = `target:${name}`;
			const label = `Target ${name}`;
			try {
				const response = await fetchFn(url, {
					method: "GET",
					redirect: "manual",
					signal: AbortSignal.timeout(timeoutMs),
				});
				await response.body?.cancel().catch(() => undefined);
				return { id, label, ok: true, detail: `reachable at ${url} (HTTP ${response.status})` };
			} catch (error) {
				return {
					id,
					label,
					ok: false,
					detail: `not reachable at ${url} (${probeFailureReason(error)})`,
					fix: targetFixHint(name),
				};
			}
		}),
	);
}

/**
 * Environment diagnostics for `agent-evaluator doctor` and the settings page: provider presence,
 * Chromium installation, workspace layout and whether configured models point at configured
 * providers, plus (when `targets` are given) whether each target URL answers. Never includes
 * secret values.
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorCheck[]> {
	const registry = options.registry ?? createProviderRegistry();
	const exists = options.exists ?? existsSync;
	return [
		...providerChecks(registry, options.secrets),
		await browserCheck(options, exists),
		...workspaceChecks(options.workspaceRoot, exists),
		...modelChecks(options.settings, registry, options.secrets),
		...(await targetChecks(
			options.targets ?? [],
			options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
			options.targetTimeoutMs ?? TARGET_PROBE_TIMEOUT_MS,
		)),
	];
}
