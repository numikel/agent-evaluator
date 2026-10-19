/**
 * Opt-in smoke test with real models: `AE_LIVE_LLM=1 npm run test:e2e` (or `npm run test:live`).
 * Models come from the workspace settings template overridden by `AE_MODEL_SIMULATOR` /
 * `AE_MODEL_JUDGE`, keys from the environment. Never runs in CI. Only asserts that a verdict is
 * produced and the report renders — the LLM's judgement is not what is under test here.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { type DemoServer, startDemo } from "../fixtures/demo-chatbot/server.js";
import {
	createProviderRegistry,
	createRunner,
	EnvSecretsProvider,
	LangChainModelFactory,
	PlaywrightSessionFactory,
	type RunnerHandle,
	resolveSettings,
} from "../src/index.js";
import { type E2eWorkspace, makeE2eWorkspace, SCENARIO } from "./helpers.js";

const LIVE = process.env.AE_LIVE_LLM === "1";
const LIVE_TIMEOUT_MS = 170_000;

describe.skipIf(!LIVE)("live LLM smoke (AE_LIVE_LLM=1)", () => {
	let demo: DemoServer | undefined;
	let ws: E2eWorkspace | undefined;
	let runner: RunnerHandle | undefined;

	afterEach(async () => {
		await runner?.close().catch(() => undefined);
		await demo?.close().catch(() => undefined);
		await ws?.cleanup();
		runner = undefined;
		demo = undefined;
		ws = undefined;
	});

	it(
		"produces a verdict and a report against the demo chatbot with real models",
		async () => {
			demo = await startDemo(0);
			ws = await makeE2eWorkspace(demo, { responseMs: 60_000 });
			// Apply the AE_MODEL_* env layer to the workspace file so the runner builds those models.
			const settings = resolveSettings({
				file: await ws.workspace.loadSettings(),
				env: process.env,
			});
			await ws.workspace.writeRaw("settings", stringify(settings));

			const secrets = new EnvSecretsProvider();
			runner = createRunner({
				workspace: ws.workspace,
				runStore: ws.runStore,
				browserFactory: new PlaywrightSessionFactory(),
				modelFactory: new LangChainModelFactory({ secrets, registry: createProviderRegistry() }),
			});
			const { runIds } = await runner.start({ scenario: SCENARIO });
			const runId = runIds[0] as string;
			const record = await runner.wait(runId);

			expect(record.error).toBeUndefined();
			expect(["PASSED", "FAILED"]).toContain(record.status);
			const verdict = await ws.runStore.readVerdict(runId);
			expect(verdict?.status).toBe(record.status);
			expect(verdict?.criteria.length).toBeGreaterThan(0);
			const dir = ws.runStore.dir(runId);
			expect(existsSync(join(dir, "verdict.json"))).toBe(true);
			const report = await readFile(join(dir, "report.html"), "utf8");
			expect(report).toContain(record.status);
			expect(report).toContain("%");
		},
		LIVE_TIMEOUT_MS,
	);
});
