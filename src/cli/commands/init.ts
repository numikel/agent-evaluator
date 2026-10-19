import type { Command } from "commander";
import { workspaceRoot } from "../context.js";
import type { CliDeps } from "../deps.js";

export function registerInit(program: Command, deps: CliDeps): void {
	program
		.command("init")
		.description("Create a workspace with an example persona, scenario, rubric and target")
		.argument("[dir]", "workspace directory (default: current directory)")
		.option("-f, --force", "overwrite existing files with the shipped templates")
		.action(async (dir: string | undefined, options: { force?: boolean }) => {
			const root = workspaceRoot(deps, dir);
			const created = await deps
				.openWorkspace(root)
				.init(options.force ? { force: true } : undefined);
			if (created.length === 0) {
				deps.stdout(
					`Workspace at ${root} is already initialised (use --force to overwrite the templates).\n`,
				);
				return;
			}
			deps.stdout(`Initialised workspace at ${root}\n`);
			for (const file of created) deps.stdout(`  created ${file}\n`);
			deps.stdout(
				"\nNext: export a provider key (e.g. ANTHROPIC_API_KEY), then run `agent-evaluator doctor` " +
					"and `agent-evaluator serve`.\n",
			);
		});
}
