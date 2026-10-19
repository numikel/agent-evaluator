import { type Command, InvalidArgumentError } from "commander";
import type { SettingsOverrides } from "../../config/index.js";
import { openContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { runnerLogger } from "./run.js";

/** Commander option parser for a TCP port; `0` lets the server pick a free one. */
export function parsePort(value: string): number {
	if (!/^\d+$/.test(value)) throw new InvalidArgumentError("must be an integer");
	const port = Number.parseInt(value, 10);
	if (port > 65_535) throw new InvalidArgumentError("must be at most 65535");
	return port;
}

export function registerServe(program: Command, deps: CliDeps): void {
	program
		.command("serve")
		.description("Start the web UI and API (Ctrl+C stops it)")
		.option("-p, --port <port>", "port to listen on (default: settings, 4747)", parsePort)
		.option("-H, --host <host>", "host to bind (default: settings, 127.0.0.1)")
		.option("-w, --workspace <dir>", "workspace directory (default: current directory)")
		.option("--open", "open the UI in the browser once the server is up")
		.action(
			async (options: { port?: number; host?: string; workspace?: string; open?: boolean }) => {
				const server: NonNullable<SettingsOverrides["server"]> = {};
				if (options.port !== undefined && options.port > 0) server.port = options.port;
				if (options.host !== undefined) server.host = options.host;
				const ctx = await openContext(deps, {
					workspace: options.workspace,
					overrides: { server },
				});
				const runner = deps.createRunner({
					workspace: ctx.workspace,
					runStore: ctx.runStore,
					logger: runnerLogger(deps),
				});
				const app = deps.createApp({
					workspace: ctx.workspace,
					runStore: ctx.runStore,
					runner,
					providers: deps.providers,
					secrets: deps.secrets,
					settingsLoader: ctx.settingsLoader,
					browserInstalled: deps.browserInstalled,
					version: deps.version,
					logger: deps.logger,
				});
				const running = await deps.startServer({
					app,
					host: ctx.settings.server.host,
					port: options.port === 0 ? 0 : ctx.settings.server.port,
					logger: deps.logger,
					handleSignals: false,
				});
				deps.onShutdown(async () => {
					await running.close();
					await runner.close();
				});
				deps.stdout(
					`agent-evaluator ${deps.version} listening on ${running.url}\n` +
						`  workspace: ${ctx.root}\n` +
						`  runs:      ${ctx.runStore.root}\n` +
						"Press Ctrl+C to stop.\n",
				);
				if (options.open) {
					try {
						await deps.openUrl(running.url);
					} catch (error) {
						deps.stderr(
							`could not open a browser: ${error instanceof Error ? error.message : String(error)}\n`,
						);
					}
				}
			},
		);
}
