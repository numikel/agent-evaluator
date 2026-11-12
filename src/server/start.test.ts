import { connect } from "node:net";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { startServer } from "./start.js";
import { createFakeDeps } from "./testing.js";

/** Sends a raw HTTP/1.1 request line (no client-side URL normalisation) and returns the status code. */
function rawStatus(port: number, target: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const socket = connect(port, "127.0.0.1", () => {
			socket.write(
				`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
			);
		});
		let head = "";
		socket.setEncoding("latin1");
		socket.on("data", (chunk: string) => {
			head += chunk;
		});
		socket.on("error", reject);
		socket.on("close", () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? Number.NaN)));
	});
}

describe("startServer", () => {
	it("listens on a free port, serves the app and closes cleanly", async () => {
		const app = createApp({
			...createFakeDeps(),
			version: "1.2.3",
			logger: pino({ level: "silent" }),
		});
		const server = await startServer({
			app,
			host: "127.0.0.1",
			port: 0,
			handleSignals: false,
			logger: pino({ level: "silent" }),
		});
		try {
			expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect(server.port).toBeGreaterThan(0);
			const res = await fetch(`${server.url}/api/health`);
			expect(await res.json()).toEqual({ ok: true, version: "1.2.3" });
		} finally {
			await server.close();
		}
		await expect(fetch(`${server.url}/api/health`)).rejects.toThrow();
	});

	it("rejects a raw backslash in the request path instead of reading it as '/' (GHSA-jpvv-r467-5p4w)", async () => {
		const app = createApp({ ...createFakeDeps(), logger: pino({ level: "silent" }) });
		const server = await startServer({
			app,
			port: 0,
			handleSignals: false,
			logger: pino({ level: "silent" }),
		});
		try {
			expect(await rawStatus(server.port, "/api/health")).toBe(200);
			expect(await rawStatus(server.port, "/api\\health")).toBe(400);
			expect(await rawStatus(server.port, "/api/x/..\\health")).toBe(400);
		} finally {
			await server.close();
		}
	});
});
