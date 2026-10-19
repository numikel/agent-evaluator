import pino from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { startServer } from "./start.js";
import { createFakeDeps } from "./testing.js";

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
});
