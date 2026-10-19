import { Command } from "commander";
import { VERSION } from "../index.js";

/**
 * CLI entry point. P0 ships only `--version` and a `doctor` placeholder; P11 adds
 * `init | serve | run | validate | report | templates | doctor`.
 */
export function buildCli(): Command {
	const program = new Command("agent-evaluator")
		.description("Automated UI-level evaluator for chatbots and AI agents")
		.version(VERSION);

	program
		.command("doctor")
		.description("Check providers, browser installation and workspace health")
		.action(() => {
			process.stdout.write(
				"agent-evaluator doctor: not implemented yet (see docs/plans/phase-11-cli.md)\n",
			);
		});

	return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	buildCli()
		.parseAsync(process.argv)
		.catch((error: unknown) => {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		});
}
