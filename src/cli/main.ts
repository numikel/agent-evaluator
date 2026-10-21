/**
 * CLI entry point: `agent-evaluator init | serve | run | validate | report | templates | doctor | demo`.
 * `buildCli(deps)` returns the commander program (tests inject fakes and capture output);
 * `runCli(argv, deps)` parses and maps every outcome to an exit code without exiting the process.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { registerDemo } from "./commands/demo.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerInit } from "./commands/init.js";
import { registerReport } from "./commands/report.js";
import { registerRun } from "./commands/run.js";
import { registerServe } from "./commands/serve.js";
import { registerTemplates } from "./commands/templates.js";
import { registerValidate } from "./commands/validate.js";
import { type CliDeps, createCliDeps } from "./deps.js";
import { CliExitError } from "./output.js";

export type { CliDeps } from "./deps.js";

/** Builds the program; commander never calls `process.exit`, it throws `CommanderError` instead. */
export function buildCli(overrides: Partial<CliDeps> = {}): Command {
	const deps = createCliDeps(overrides);
	const program = new Command("agent-evaluator")
		.description("Automated UI-level evaluator for chatbots and AI agents")
		.version(deps.version)
		.exitOverride()
		.configureOutput({ writeOut: deps.stdout, writeErr: deps.stderr })
		.showHelpAfterError("(run with --help for usage)");

	registerInit(program, deps);
	registerServe(program, deps);
	registerRun(program, deps);
	registerValidate(program, deps);
	registerReport(program, deps);
	registerTemplates(program, deps);
	registerDoctor(program, deps);
	registerDemo(program, deps);
	return program;
}

/**
 * Parses `argv` (user arguments only, without `node` and the script) and resolves with the exit
 * code: 0 on success, the command's code on an expected failure (`CliExitError`), commander's code
 * for usage errors/help/version, 1 for anything unexpected (message written to stderr).
 */
export async function runCli(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
	const deps = createCliDeps(overrides);
	try {
		await buildCli(deps).parseAsync(argv, { from: "user" });
		return 0;
	} catch (error) {
		if (error instanceof CommanderError) return error.exitCode;
		if (error instanceof CliExitError) {
			if (error.message) deps.stderr(`${error.message}\n`);
			return error.exitCode;
		}
		deps.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
}

function isEntryPoint(): boolean {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(entry)).href;
	} catch {
		return false;
	}
}

if (isEntryPoint()) {
	runCli(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}
