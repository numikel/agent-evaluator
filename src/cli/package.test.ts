/**
 * The built package as a library consumer sees it: `import … from "agent-evaluator"` resolves to
 * `dist/index.js` and `dist/index.d.ts` through `package.json#exports`. Guards the bundler and the
 * declaration generator (tsdown, rolldown-plugin-dts): the runtime exports must match `src/index.ts`
 * and the README wiring must type-check without anything collapsing to `any`. Runs only when the
 * package has been built (`npm run build`), so a clean checkout skips it.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { packageRoot } from "../server/paths.js";

const ROOT = packageRoot();
const DIST_INDEX = join(ROOT, "dist", "index.js");
const DIST_TYPES = join(ROOT, "dist", "index.d.ts");

/** The wiring from the `src/index.ts` doc comment, plus a few public types a consumer relies on. */
const CONSUMER = `import { join } from "node:path";
import {
	createProviderRegistry,
	createRunner,
	EnvSecretsProvider,
	LangChainModelFactory,
	openRunStore,
	openWorkspace,
	PlaywrightSessionFactory,
	type RunEvent,
	type RunnerHandle,
	SettingsSchema,
	VERSION,
} from "agent-evaluator";

/** Does not compile when the argument is typed \`any\`, i.e. when a declaration lost its type. */
function typed<T>(value: T, ..._notAny: 0 extends 1 & T ? ["collapsed to any"] : []): T {
	return value;
}

export async function wire(root: string): Promise<RunnerHandle> {
	const workspace = openWorkspace(root);
	const settings = typed(await workspace.loadSettings());
	const runStore = openRunStore(join(root, typed(settings.runs_dir)));
	const secrets = new EnvSecretsProvider();
	const modelFactory = new LangChainModelFactory({ secrets, registry: createProviderRegistry() });
	typed(await modelFactory.forRole("judge", settings));
	return typed(
		createRunner({
			workspace,
			runStore,
			browserFactory: new PlaywrightSessionFactory(),
			modelFactory,
		}),
	);
}

export async function firstRun(runner: RunnerHandle): Promise<string> {
	const { runIds } = typed(await runner.start({ scenario: "invoice", repeat: 1 }));
	return typed((await runner.wait(runIds[0] ?? "")).status);
}

export const describeEvent = (event: RunEvent): string =>
	event.type === "done" ? typed(event.verdict.status) : typed(event.runId);

export const defaults = typed(SettingsSchema.parse({}).models.judge);
export const version = typed(VERSION);

// @ts-expect-error the start request requires a scenario
export const missingScenario: Parameters<RunnerHandle["start"]>[0] = {};
`;

const TSCONFIG = {
	compilerOptions: {
		target: "ES2022",
		module: "NodeNext",
		moduleResolution: "NodeNext",
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: ["node"],
	},
	files: ["consumer.ts"],
};

describe.skipIf(!existsSync(DIST_INDEX) || !existsSync(DIST_TYPES))("dist/index", () => {
	it("exports the same runtime API as src/index.ts", async () => {
		const built = await import(pathToFileURL(DIST_INDEX).href);
		const source = await import("../index.js");
		expect(Object.keys(built).sort()).toEqual(Object.keys(source).sort());
		expect(built.VERSION).toBe(source.VERSION);
	});

	it("type-checks a consumer that imports the package by name", async () => {
		// Inside the package so that the self-reference "agent-evaluator" resolves via exports.
		const base = join(ROOT, "test-results");
		await mkdir(base, { recursive: true });
		const dir = await mkdtemp(join(base, "consumer-"));
		try {
			await writeFile(join(dir, "consumer.ts"), CONSUMER);
			await writeFile(join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG));
			const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
			let output = "";
			try {
				execFileSync(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], {
					encoding: "utf8",
					stdio: "pipe",
				});
			} catch (error) {
				const { stdout, stderr } = error as { stdout?: string; stderr?: string };
				output = `${stdout ?? ""}${stderr ?? ""}` || String(error);
			}
			expect(output).toBe("");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 60_000);
});
