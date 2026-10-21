/**
 * Seam 6 of the brief: `node dist/cli.js --help` lists every command. Runs only when the package
 * has been built (`npm run build`), so a clean checkout skips it.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot } from "../server/paths.js";

const DIST_CLI = join(packageRoot(), "dist", "cli.js");

describe.skipIf(!existsSync(DIST_CLI))("dist/cli.js", () => {
	it("--help lists every command", () => {
		const help = execFileSync(process.execPath, [DIST_CLI, "--help"], { encoding: "utf8" });
		for (const command of [
			"init",
			"serve",
			"run",
			"validate",
			"report",
			"templates",
			"doctor",
			"demo",
		]) {
			expect(help).toContain(command);
		}
	});

	it("--version prints the package version", () => {
		const version = execFileSync(process.execPath, [DIST_CLI, "--version"], { encoding: "utf8" });
		expect(version.trim()).toBe("0.1.1");
	});
});
