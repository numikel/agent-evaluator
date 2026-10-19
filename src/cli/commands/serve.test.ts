import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { RunnerHandle } from "../../runner/index.js";
import type { ServerDeps, StartServerOptions } from "../../server/index.js";
import { createFakeDeps, type FakeDeps } from "../../server/testing.js";
import { createCliHarness } from "../testing.js";

type Captured = {
	app: ServerDeps[];
	server: StartServerOptions[];
	opened: string[];
	closed: string[];
	shutdown: Array<() => Promise<void>>;
	runnerClosed: number;
};

function harness(options: { env?: Record<string, string>; fakes?: FakeDeps } = {}) {
	const fakes = options.fakes ?? createFakeDeps();
	const captured: Captured = {
		app: [],
		server: [],
		opened: [],
		closed: [],
		shutdown: [],
		runnerClosed: 0,
	};
	const runner: RunnerHandle = Object.assign(fakes.runner, {
		wait: async () => {
			throw new Error("not used");
		},
		close: async () => {
			captured.runnerClosed += 1;
		},
	});
	const cli = createCliHarness({
		env: options.env ?? {},
		openWorkspace: () => fakes.workspace,
		openRunStore: () => fakes.runStore,
		providers: fakes.providers,
		secrets: fakes.secrets,
		createRunner: () => runner,
		createApp: (deps) => {
			captured.app.push(deps);
			return new Hono();
		},
		startServer: async (serverOptions) => {
			captured.server.push(serverOptions);
			const port = serverOptions.port === 0 ? 43210 : (serverOptions.port ?? 4747);
			return {
				url: `http://${serverOptions.host ?? "127.0.0.1"}:${port}`,
				host: serverOptions.host ?? "127.0.0.1",
				port,
				close: async () => {
					captured.closed.push("server");
				},
			};
		},
		openUrl: async (url) => {
			captured.opened.push(url);
		},
		onShutdown: (handler) => {
			captured.shutdown.push(handler);
		},
	});
	return { cli, captured, fakes };
}

describe("serve", () => {
	it("builds the app with the package version, starts the server and prints the URL", async () => {
		const { cli, captured } = harness();
		expect(await cli.run("serve")).toBe(0);

		expect(captured.server).toHaveLength(1);
		expect(captured.server[0]).toMatchObject({
			host: "127.0.0.1",
			port: 4747,
			handleSignals: false,
		});
		expect(captured.app[0]).toMatchObject({ version: "0.1.0" });
		expect(captured.app[0]?.workspace).toBeDefined();
		expect(captured.app[0]?.runner).toBeDefined();
		expect(cli.stdout()).toContain("http://127.0.0.1:4747");
		expect(captured.opened).toEqual([]);
	});

	it("honours --port and --host over the settings, and --open opens the URL", async () => {
		const { cli, captured } = harness();
		expect(await cli.run("serve", "--port", "0", "--host", "0.0.0.0", "--open")).toBe(0);
		expect(captured.server[0]).toMatchObject({ host: "0.0.0.0", port: 0 });
		expect(captured.opened).toEqual(["http://0.0.0.0:43210"]);
	});

	it("applies AE_PORT from the environment", async () => {
		const { cli, captured } = harness({ env: { AE_PORT: "5151" } });
		expect(await cli.run("serve")).toBe(0);
		expect(captured.server[0]).toMatchObject({ port: 5151 });
	});

	it("closes the server and the runner on shutdown", async () => {
		const { cli, captured } = harness();
		expect(await cli.run("serve")).toBe(0);
		expect(captured.shutdown).toHaveLength(1);
		await captured.shutdown[0]?.();
		expect(captured.closed).toEqual(["server"]);
		expect(captured.runnerClosed).toBe(1);
	});

	it("rejects a non-numeric --port", async () => {
		const { cli } = harness();
		expect(await cli.run("serve", "--port", "http")).toBe(1);
		expect(cli.stderr()).toContain("--port");
	});
});
