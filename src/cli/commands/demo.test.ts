import { describe, expect, it } from "vitest";
import type { DemoAppOptions, DemoServer } from "../../../fixtures/demo-chatbot/server.js";
import { startDemo } from "../../../fixtures/demo-chatbot/server.js";
import { createCliHarness } from "../testing.js";

function fakeStartDemo(calls: Array<{ port: number; options: DemoAppOptions | undefined }>) {
	return async (port: number, options?: DemoAppOptions): Promise<DemoServer> => {
		calls.push({ port, options });
		return {
			url: `http://localhost:${port || 54321}`,
			port: port || 54321,
			app: {} as DemoServer["app"],
			close: async () => undefined,
		};
	};
}

describe("demo", () => {
	it("starts the demo chatbot on the default port and prints the URL and the target hint", async () => {
		const calls: Array<{ port: number; options: DemoAppOptions | undefined }> = [];
		const shutdown: Array<() => Promise<void>> = [];
		const cli = createCliHarness({
			startDemo: fakeStartDemo(calls),
			onShutdown: (handler) => {
				shutdown.push(handler);
			},
		});
		expect(await cli.run("demo")).toBe(0);
		expect(calls).toEqual([{ port: 3999, options: {} }]);
		expect(cli.stdout()).toContain("http://localhost:3999");
		expect(cli.stdout()).toContain("targets/demo-chatbot.yaml");
		expect(shutdown).toHaveLength(1);
	});

	it("passes --port and --mode through", async () => {
		const calls: Array<{ port: number; options: DemoAppOptions | undefined }> = [];
		const cli = createCliHarness({ startDemo: fakeStartDemo(calls) });
		expect(await cli.run("demo", "--port", "0", "--mode", "slow")).toBe(0);
		expect(calls).toEqual([{ port: 0, options: { defaultMode: "slow" } }]);
		expect(cli.stdout()).toContain("mode:   slow");
	});

	it("rejects an unknown mode", async () => {
		const calls: Array<{ port: number; options: DemoAppOptions | undefined }> = [];
		const cli = createCliHarness({ startDemo: fakeStartDemo(calls) });
		expect(await cli.run("demo", "--mode", "turbo")).not.toBe(0);
		expect(calls).toHaveLength(0);
		expect(cli.stderr()).toContain("must be one of");
	});

	it("the real demo server serves the chat page and its script", async () => {
		const demo = await startDemo(0, { delayScale: 0 });
		try {
			const page = await fetch(`${demo.url}/`);
			expect(page.status).toBe(200);
			expect(await page.text()).toContain("Acme Support");
			const script = await fetch(`${demo.url}/app.js`);
			expect(script.status).toBe(200);
			expect(script.headers.get("content-type")).toContain("javascript");
		} finally {
			await demo.close();
		}
	});
});
