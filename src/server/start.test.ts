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

/** Polls `condition` every few milliseconds; fails after `timeoutMs`. */
async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("condition not met in time");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
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

	it("carries the UI round trip over a real socket: JSON bodies in, live SSE out, unsubscribe on disconnect", async () => {
		// app.test.ts drives the routes in-process (`app.request`); this goes through the Node
		// adapter's request body handling and response streaming, which `@hono/node-server` owns.
		const deps = createFakeDeps();
		const app = createApp({ ...deps, heartbeatMs: 60_000, logger: pino({ level: "silent" }) });
		const server = await startServer({
			app,
			port: 0,
			handleSignals: false,
			logger: pino({ level: "silent" }),
		});
		const send = (method: string, path: string, body: unknown) =>
			fetch(`${server.url}${path}`, {
				method,
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		try {
			const scenario = {
				name: "invoice",
				persona: "alice",
				target: "demo",
				goal: "Get the invoice.",
				intent: "Download the September invoice — as PDF, «please».",
				success_criteria: "A PDF invoice was downloaded.",
				max_turns: 3,
			};
			expect((await send("PUT", "/api/scenarios/invoice", scenario)).status).toBe(204);
			expect(await deps.workspace.loadScenario("invoice")).toMatchObject(scenario);

			const started = await send("POST", "/api/runs", { scenario: "invoice" });
			expect(started.status).toBe(202);
			const { runIds } = (await started.json()) as { runIds: string[] };
			const runId = runIds[0] as string;
			expect(deps.runner.started).toEqual([{ scenario: "invoice" }]);

			const abort = new AbortController();
			const events = await fetch(`${server.url}/api/runs/${runId}/events`, {
				signal: abort.signal,
			});
			expect(events.headers.get("content-type")).toMatch(/^text\/event-stream/);
			const reader = events.body?.getReader();
			if (!reader) throw new Error("no SSE body");
			await until(() => deps.runner.listenerCount(runId) === 1);
			deps.runner.emit({
				runId,
				at: "2026-11-23T10:00:00.000Z",
				type: "log",
				level: "info",
				message: "turn one ✓",
			});
			const decoder = new TextDecoder();
			let text = "";
			while (!text.includes("turn one ✓")) {
				const { done, value } = await reader.read();
				if (done) break;
				text += decoder.decode(value, { stream: true });
			}
			expect(text).toMatch(/^data: \{.*"turn one ✓"/m);

			abort.abort();
			await until(() => deps.runner.listenerCount(runId) === 0);
		} finally {
			await server.close();
		}
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
