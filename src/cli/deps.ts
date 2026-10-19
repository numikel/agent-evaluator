/**
 * Everything the CLI commands touch that is not pure computation, so tests (and the E2E phase)
 * can inject fakes through `buildCli(deps)` / `runCli(argv, deps)`.
 *
 * To run the CLI against scripted models and a fake browser, inject `createRunner`:
 *
 * ```ts
 * runCli(["run", "my-scenario"], {
 *   createRunner: ({ workspace, runStore, logger }) =>
 *     createRunner({ workspace, runStore, browserFactory: fakeBrowsers, modelFactory: scripted, logger }),
 * });
 * ```
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Hono } from "hono";
import pino, { type Logger } from "pino";
import { PlaywrightSessionFactory, resolveChromiumExecutable } from "../browser/index.js";
import {
	createProviderRegistry,
	EnvSecretsProvider,
	LangChainModelFactory,
} from "../config/index.js";
import type { ProviderRegistry, SecretsProvider } from "../config/types.js";
import { VERSION } from "../index.js";
import { createRunner, type RunnerHandle, type RunnerLogger } from "../runner/index.js";
import {
	createApp,
	type RunningServer,
	type ServerDeps,
	type StartServerOptions,
	startServer,
} from "../server/index.js";
import { openRunStore, openWorkspace } from "../workspace/index.js";
import type { RunStore, Workspace } from "../workspace/types.js";
import { colorEnabled } from "./output.js";

export type CreateRunnerInput = {
	workspace: Workspace;
	runStore: RunStore;
	logger?: RunnerLogger;
};

export type CliDeps = {
	version: string;
	/** Environment the CLI reads (`AE_*`, `NO_COLOR`, provider keys through `secrets`). */
	env: Record<string, string | undefined>;
	/** Directory relative paths (workspace, `init [dir]`, `--out`) resolve against. */
	cwd: string;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	color: boolean;
	logger: Logger;
	secrets: SecretsProvider;
	providers: ProviderRegistry;
	openWorkspace: (root: string) => Workspace;
	openRunStore: (root: string) => RunStore;
	/** Builds the runner for a workspace; the default wires Playwright and LangChain. */
	createRunner: (input: CreateRunnerInput) => RunnerHandle;
	createApp: (deps: ServerDeps) => Hono;
	startServer: (options: StartServerOptions) => Promise<RunningServer>;
	/** Whether a Chromium build is available for Playwright (reported by the settings API). */
	browserInstalled: () => Promise<boolean>;
	/** Chromium path the doctor checks; the default honours `AE_CHROMIUM_PATH` like the factory. */
	chromiumExecutablePath: () => string | Promise<string>;
	exists: (path: string) => boolean;
	/** Opens a URL in the user's browser (`--open`). */
	openUrl: (url: string) => Promise<void>;
	/** Registers the handler run on SIGINT/SIGTERM; the default exits the process afterwards. */
	onShutdown: (handler: () => Promise<void>) => void;
};

function defaultOpenUrl(url: string): Promise<void> {
	const [command, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "ignore", detached: true });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

function defaultOnShutdown(handler: () => Promise<void>): void {
	const onSignal = () => {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		handler()
			.catch(() => undefined)
			.finally(() => process.exit(0));
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
}

/** Real dependencies, with any subset replaced by `overrides`. */
export function createCliDeps(overrides: Partial<CliDeps> = {}): CliDeps {
	const env = overrides.env ?? process.env;
	const secrets = overrides.secrets ?? new EnvSecretsProvider({ env });
	const providers = overrides.providers ?? createProviderRegistry();
	const defaults: CliDeps = {
		version: VERSION,
		env,
		cwd: process.cwd(),
		stdout: (text) => {
			process.stdout.write(text);
		},
		stderr: (text) => {
			process.stderr.write(text);
		},
		color: colorEnabled(env, process.stdout.isTTY === true),
		logger: pino({ name: "agent-evaluator", level: env.LOG_LEVEL ?? "warn" }),
		secrets,
		providers,
		openWorkspace,
		openRunStore,
		createRunner: ({ workspace, runStore, logger }) =>
			createRunner({
				workspace,
				runStore,
				browserFactory: new PlaywrightSessionFactory(),
				modelFactory: new LangChainModelFactory({ secrets, registry: providers }),
				...(logger ? { logger } : {}),
			}),
		createApp,
		startServer,
		browserInstalled: async () => {
			try {
				return existsSync(resolveChromiumExecutable());
			} catch {
				return false;
			}
		},
		chromiumExecutablePath: () => resolveChromiumExecutable(),
		exists: existsSync,
		openUrl: defaultOpenUrl,
		onShutdown: defaultOnShutdown,
	};
	return { ...defaults, ...overrides };
}
