import { describe, expect, it } from "vitest";
import { buildCli } from "./main.js";
import { createCliHarness } from "./testing.js";

const COMMANDS = ["init", "serve", "run", "validate", "report", "templates", "doctor"];

describe("cli", () => {
	it("exposes the package version", () => {
		const program = buildCli();
		expect(program.version()).toBe("0.1.0");
		expect(program.commands.map((c) => c.name())).toContain("doctor");
	});

	it("registers every command of the brief", () => {
		const names = buildCli().commands.map((c) => c.name());
		for (const command of COMMANDS) expect(names).toContain(command);
	});

	it("--help lists every command and exits 0 through the injected writers", async () => {
		const cli = createCliHarness();
		expect(await cli.run("--help")).toBe(0);
		for (const command of COMMANDS) expect(cli.stdout()).toContain(command);
	});

	it("--version prints the version", async () => {
		const cli = createCliHarness();
		expect(await cli.run("--version")).toBe(0);
		expect(cli.stdout().trim()).toBe("0.1.0");
	});

	it("unknown commands exit 1 with a usage error on stderr", async () => {
		const cli = createCliHarness();
		expect(await cli.run("frobnicate")).toBe(1);
		expect(cli.stderr()).toContain("frobnicate");
	});
});
