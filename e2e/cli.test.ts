/**
 * The CLI end to end, in two halves:
 *
 * - `init`, `validate`, `templates` and `doctor` run the built binary (`node dist/cli.js`) as real
 *   child processes in a temp directory and assert exit codes and output;
 * - `run --json` goes through `runCli` in-process with a scripted runner injected via `CliDeps`
 *   (the real binary has no hook for scripted models) against the demo chatbot on real Chromium.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type DemoServer, startDemo } from "../fixtures/demo-chatbot/server.js";
import { createCliHarness } from "../src/cli/testing.js";
import {
	createProviderRegistry,
	createRunner,
	PlaywrightSessionFactory,
	type RunStore,
} from "../src/index.js";
import {
	type E2eWorkspace,
	judgeOutputs,
	makeE2eWorkspace,
	SCENARIO,
	scriptedModels,
	setScalar,
} from "./helpers.js";

const DIST_CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

type ProcessResult = { code: number; stdout: string; stderr: string };

/** Env for the child: no provider keys (so `doctor` is deterministic), no colours, Chromium kept. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...extra };
	for (const def of createProviderRegistry().all()) {
		if (!(def.env in extra)) delete env[def.env];
	}
	return env;
}

function cli(args: string[], options: { cwd: string; env?: Record<string, string> }) {
	return new Promise<ProcessResult>((resolve, reject) => {
		const child = spawn(process.execPath, [DIST_CLI, ...args], {
			cwd: options.cwd,
			env: childEnv(options.env),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", reject);
		child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
	});
}

describe("node dist/cli.js (child processes)", () => {
	let dir: string;

	beforeAll(async () => {
		if (!existsSync(DIST_CLI)) {
			throw new Error(`${DIST_CLI} is missing: run \`npm run build\` before \`npm run test:e2e\``);
		}
		dir = await mkdtemp(join(tmpdir(), "ae-e2e-cli-"));
	});

	afterAll(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	it("init creates a workspace, then reports it as already initialised", async () => {
		const root = join(dir, "ws");
		const first = await cli(["init", root], { cwd: dir });
		expect(first.code).toBe(0);
		expect(first.stdout).toContain(`Initialised workspace at ${root}`);
		expect(first.stdout).toContain("created scenarios/invoice-export-september.yaml");
		for (const file of [
			"agent-evaluator.yaml",
			"evaluator.yaml",
			"personas/impatient-smb-owner.md",
			"scenarios/invoice-export-september.yaml",
			"rubrics/customer-support.yaml",
			"targets/demo-chatbot.yaml",
		]) {
			expect(existsSync(join(root, file)), file).toBe(true);
		}

		const second = await cli(["init"], { cwd: root });
		expect(second.code).toBe(0);
		expect(second.stdout).toContain("already initialised");
	});

	it("validate passes on a fresh workspace and exits 1 on a broken reference", async () => {
		const root = join(dir, "ws");
		const ok = await cli(["validate", "--workspace", root], { cwd: dir });
		expect(ok.code).toBe(0);
		expect(ok.stdout).toContain("no issues");

		const scenario = join(root, "scenarios", `${SCENARIO}.yaml`);
		const original = await readFile(scenario, "utf8");
		await writeFile(scenario, setScalar(original, "target", "nope-chatbot"));
		try {
			const bad = await cli(["validate"], { cwd: root });
			expect(bad.code).toBe(1);
			expect(bad.stdout).toContain(`scenarios/${SCENARIO}.yaml`);
			expect(bad.stdout).toMatch(/nope-chatbot/);
			expect(bad.stderr).toMatch(/issue/);
		} finally {
			await writeFile(scenario, original);
		}
	});

	it("templates lists, prints and exports the shipped templates", async () => {
		const list = await cli(["templates"], { cwd: dir });
		expect(list.code).toBe(0);
		for (const kind of ["persona", "scenario", "rubric", "target", "evaluator", "settings"]) {
			expect(list.stdout).toContain(kind);
		}

		const one = await cli(["templates", "--kind", "target"], { cwd: dir });
		expect(one.code).toBe(0);
		expect(one.stdout).toContain("url: http://localhost:3999");

		const out = join(dir, "exported");
		const exported = await cli(["templates", "--out", out], { cwd: dir });
		expect(exported.code).toBe(0);
		expect((await readdir(out)).sort()).toEqual([
			"PERSONA.md",
			"agent-evaluator.yaml",
			"evaluator.yaml",
			"rubric.yaml",
			"scenario.yaml",
			"target.yaml",
		]);

		const bogus = await cli(["templates", "--kind", "bogus"], { cwd: dir });
		expect(bogus.code).toBe(1);
		expect(bogus.stderr).toContain("unknown template kind 'bogus'");
	});

	it("doctor exits 1 without provider keys and 0 once the configured provider has one", async () => {
		const root = join(dir, "ws");
		const missing = await cli(["doctor", "--workspace", root], { cwd: dir });
		expect(missing.code).toBe(1);
		expect(missing.stdout).toContain("simulator model");
		expect(missing.stdout).toContain("Chromium for Playwright");
		expect(missing.stderr).toMatch(/blocking problem/);

		const ready = await cli(["doctor"], { cwd: root, env: { ANTHROPIC_API_KEY: "e2e-dummy" } });
		expect(ready.code).toBe(0);
		expect(ready.stdout).toContain("All required checks passed");
	});

	it("run exits 1 for an unknown scenario without starting a browser", async () => {
		const root = join(dir, "ws");
		const result = await cli(["run", "no-such-scenario"], { cwd: root });
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("cannot run 'no-such-scenario'");
		expect(existsSync(join(root, "runs"))).toBe(true);
		expect(await readdir(join(root, "runs"))).toEqual([]);
	});
});

describe("run --json in-process with a scripted runner", () => {
	let demo: DemoServer | undefined;
	let ws: E2eWorkspace | undefined;

	afterEach(async () => {
		await demo?.close().catch(() => undefined);
		await ws?.cleanup();
		demo = undefined;
		ws = undefined;
	});

	function harness(root: string, options: { goalReached: boolean }) {
		const models = scriptedModels({
			judge: judgeOutputs({
				goalReached: options.goalReached,
				evidenceSteps: options.goalReached ? [2, 4] : [2],
			}),
		});
		return createCliHarness({
			cwd: root,
			createRunner: ({ workspace, runStore, logger }) =>
				createRunner({
					workspace,
					runStore,
					browserFactory: new PlaywrightSessionFactory(),
					modelFactory: models,
					...(logger ? { logger } : {}),
				}),
		});
	}

	async function onlyRun(runStore: RunStore) {
		const runs = await runStore.list();
		expect(runs).toHaveLength(1);
		return runs[0] as NonNullable<(typeof runs)[0]>;
	}

	it("exits 0 and prints the summary.json of a PASSED run", async () => {
		demo = await startDemo(0);
		ws = await makeE2eWorkspace(demo);
		const h = harness(ws.root, { goalReached: true });

		const code = await h.run("run", SCENARIO, "--json");
		expect(code, h.stderr()).toBe(0);
		const summaries = JSON.parse(h.stdout()) as Array<Record<string, unknown>>;
		expect(summaries).toHaveLength(1);
		const summary = summaries[0] as Record<string, unknown>;
		expect(summary.scenario).toBe(SCENARIO);
		expect(summary.status).toBe("PASSED");
		expect(summary.goal_reached).toBe(true);
		expect(summary.percent).toBeGreaterThanOrEqual(70);
		expect(summary.turns_used).toBe(1);
		const criteria = summary.criteria as Array<{ id: string; pass: boolean }>;
		expect(criteria.find((c) => c.id === "pdf_delivered")).toMatchObject({ pass: true });

		expect(h.stderr()).toMatch(/turn 1\/6/);
		expect(h.stderr()).toMatch(/PASSED \d+%/);
		const run = await onlyRun(ws.runStore);
		expect(run.id).toBe(summary.runId);
		expect(existsSync(join(ws.runStore.dir(run.id), "report.html"))).toBe(true);
	});

	it("exits 1 and still prints the summary when the judge fails the goal", async () => {
		demo = await startDemo(0);
		ws = await makeE2eWorkspace(demo, { mode: "noattach" });
		const h = harness(ws.root, { goalReached: false });

		const code = await h.run("run", SCENARIO, "--json");
		expect(code).toBe(1);
		const summaries = JSON.parse(h.stdout()) as Array<Record<string, unknown>>;
		expect(summaries[0]).toMatchObject({
			scenario: SCENARIO,
			status: "FAILED",
			goal_reached: false,
		});
		expect(h.stderr()).toMatch(/1 failed, 0 errors out of 1 run/);
		const run = await onlyRun(ws.runStore);
		expect(run.status).toBe("FAILED");
	});
});
