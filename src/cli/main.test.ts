import { describe, expect, it } from "vitest";
import { buildCli } from "./main.js";

describe("cli", () => {
	it("exposes the package version", () => {
		const program = buildCli();
		expect(program.version()).toBe("0.1.0");
		expect(program.commands.map((c) => c.name())).toContain("doctor");
	});
});
