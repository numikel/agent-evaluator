import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRunStore, openWorkspace, packageRoot, TEMPLATE_FILES } from "./index.js";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ae-index-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("package root resolution", () => {
	it("finds the package root holding templates/ from the module location", async () => {
		const expected = resolve(fileURLToPath(new URL("../../", import.meta.url)));
		expect(await packageRoot()).toBe(expected);

		const pkg = JSON.parse(await readFile(join(expected, "package.json"), "utf8"));
		expect(pkg.name).toBe("agent-evaluator");
		expect(pkg.files).toContain("templates");
		for (const file of Object.values(TEMPLATE_FILES)) {
			expect((await stat(join(expected, "templates", file))).isFile()).toBe(true);
		}
	});
});

describe("openWorkspace / openRunStore", () => {
	it("return implementations bound to the given roots", async () => {
		const workspace = openWorkspace(root);
		expect(workspace.root).toBe(root);
		const created = await workspace.init();
		expect(created.length).toBe(Object.keys(TEMPLATE_FILES).length);

		const settings = await workspace.loadSettings();
		const store = openRunStore(join(root, settings.runs_dir));
		expect(store.root).toBe(join(root, "runs"));
		expect(await store.list()).toEqual([]);
	});
});
