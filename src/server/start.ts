import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import pino, { type Logger } from "pino";

export type StartServerOptions = {
	app: Hono;
	host?: string;
	/** `0` picks a free port. */
	port?: number;
	logger?: Logger;
	/** Close the server on SIGINT/SIGTERM and exit (default `true`; tests pass `false`). */
	handleSignals?: boolean;
};

export type RunningServer = {
	url: string;
	host: string;
	port: number;
	/** Stops accepting connections, drops open ones (SSE) and resolves when the socket is closed. */
	close(): Promise<void>;
};

function formatHost(address: string): string {
	return address.includes(":") ? `[${address}]` : address;
}

/** Starts the Hono app on a Node HTTP server and logs the URL. */
export function startServer(options: StartServerOptions): Promise<RunningServer> {
	const {
		app,
		host = "127.0.0.1",
		port = 4747,
		logger = pino({ name: "agent-evaluator", level: process.env.LOG_LEVEL ?? "info" }),
		handleSignals = true,
	} = options;

	return new Promise((resolve, reject) => {
		const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
			const url = `http://${formatHost(info.address)}:${info.port}`;
			logger.info({ url }, "agent-evaluator listening on %s", url);

			let closing: Promise<void> | undefined;
			const close = (): Promise<void> => {
				if (closing) return closing;
				closing = new Promise<void>((done, fail) => {
					if (handleSignals) {
						process.off("SIGINT", onSignal);
						process.off("SIGTERM", onSignal);
					}
					server.close((error) => (error ? fail(error) : done()));
					if ("closeAllConnections" in server) server.closeAllConnections();
				});
				return closing;
			};
			const onSignal = (signal: NodeJS.Signals) => {
				logger.info("received %s, shutting down", signal);
				close()
					.catch((error: unknown) => logger.error({ err: error }, "shutdown failed"))
					.finally(() => process.exit(0));
			};
			if (handleSignals) {
				process.once("SIGINT", onSignal);
				process.once("SIGTERM", onSignal);
			}
			resolve({ url, host: info.address, port: info.port, close });
		});
		server.once("error", (error: Error) => {
			logger.error({ err: error }, "server failed to start");
			reject(error);
		});
	});
}
