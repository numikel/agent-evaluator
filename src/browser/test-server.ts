/**
 * Tiny `node:http` server for browser tests: serves inline HTML fixtures (and custom handlers)
 * on an ephemeral port so `PlaywrightSession` can be exercised against real pages without
 * touching the network or the filesystem.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;
/** A string is served as `text/html; charset=utf-8`; a function handles the response itself. */
export type Route = string | RouteHandler;

export type TestServer = {
	/** Base URL without a trailing slash, e.g. `http://127.0.0.1:43210`. */
	url: string;
	/** Adds or replaces a route after start-up. */
	setRoute(path: string, route: Route): void;
	close(): Promise<void>;
};

export async function startTestServer(routes: Record<string, Route> = {}): Promise<TestServer> {
	const table = new Map<string, Route>(Object.entries(routes));
	const server: Server = createServer((req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		const route = table.get(path);
		if (route === undefined) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
			return;
		}
		if (typeof route === "function") {
			route(req, res);
			return;
		}
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(route);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		setRoute(path, route) {
			table.set(path, route);
		},
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}
