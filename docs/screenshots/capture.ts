/**
 * Regenerates the README screenshots: the real server and UI, the in-process demo chatbot, a
 * scripted simulator/judge (no provider keys needed) and headless Chromium.
 *
 *   npm run build && npx tsx docs/screenshots/capture.ts
 *
 * Chromium comes from `AE_CHROMIUM_PATH` when set, else Playwright's bundled build. Provider
 * presence is faked so the settings cascade renders without real keys; nothing leaves the machine.
 */
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { chromium, type Page } from "playwright";
import { SCENARIO, setupE2e } from "../../e2e/helpers.js";
import { PROVIDERS } from "../../src/config/index.js";
import { createApp, resolveChromiumExecutable, startServer, VERSION } from "../../src/index.js";
import { FakeProviderRegistry, FakeSecrets } from "../../src/server/testing.js";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const VIEWPORT = { width: 1280, height: 800 };
const MAX_BYTES = 300 * 1024;

async function shoot(page: Page, name: string): Promise<void> {
	const path = join(OUT_DIR, `${name}.png`);
	await page.screenshot({ path, animations: "disabled" });
	const { size } = await stat(path);
	const flag = size > MAX_BYTES ? "  (over the 300 kB budget!)" : "";
	console.log(`  ${name}.png  ${(size / 1024).toFixed(0)} kB${flag}`);
}

async function main(): Promise<void> {
	const ctx = await setupE2e();
	const providers = new FakeProviderRegistry([...PROVIDERS]);
	const secrets = new FakeSecrets({ ANTHROPIC_API_KEY: "redacted", OPENAI_API_KEY: "redacted" });
	const silent = pino({ level: "silent" });
	const app = createApp({
		workspace: ctx.ws.workspace,
		runStore: ctx.ws.runStore,
		runner: ctx.runner,
		providers,
		secrets,
		browserInstalled: async () => true,
		version: VERSION,
		logger: silent,
	});
	const server = await startServer({ app, port: 0, handleSignals: false, logger: silent });
	const browser = await chromium.launch({ executablePath: resolveChromiumExecutable() });
	try {
		const page = await browser.newPage({ viewport: VIEWPORT, colorScheme: "light" });
		const url = server.url;

		await page.goto(`${url}/settings`);
		await page.getByRole("combobox").first().waitFor();
		await shoot(page, "settings");

		await page.goto(`${url}/scenarios/${SCENARIO}`);
		await page.getByRole("textbox").first().waitFor();
		await shoot(page, "scenario-editor");

		// Live view: open the run page as soon as the run starts and wait for evidence to appear.
		const { runIds } = await ctx.runner.start({ scenario: SCENARIO });
		const runId = runIds[0];
		if (!runId) throw new Error("runner.start returned no run id");
		await page.goto(`${url}/runs/${runId}`);
		await page
			.getByRole("img")
			.first()
			.waitFor({ timeout: 20_000 })
			.catch(() => undefined);
		await shoot(page, "run-live");

		const record = await ctx.runner.wait(runId);
		console.log(`  run ${runId}: ${record.status}`);

		await page.goto(`${url}/runs`);
		await page.getByRole("table").waitFor();
		await shoot(page, "runs");

		await page.goto(`${url}/api/runs/${runId}/report`);
		await page.getByText(/%/).first().waitFor();
		await shoot(page, "report");
	} finally {
		await browser.close();
		await server.close();
		await ctx.cleanup();
	}
}

main().then(
	() => {
		process.exit(0);
	},
	(error: unknown) => {
		console.error(error);
		process.exit(1);
	},
);
