import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { type ResourceKind, ResourceKindSchema } from "../../schemas/index.js";
import { TEMPLATE_FILES } from "../../workspace/index.js";
import type { CliDeps } from "../deps.js";
import { CliExitError } from "../output.js";

const KINDS: readonly ResourceKind[] = ResourceKindSchema.options;

export function registerTemplates(program: Command, deps: CliDeps): void {
	program
		.command("templates")
		.description(
			"Export the shipped templates (persona, scenario, rubric, target, evaluator, settings)",
		)
		.option("-o, --out <dir>", "write the template files into this directory")
		.option(
			"-k, --kind <kind>",
			`only this kind (${KINDS.join(", ")}); printed when --out is absent`,
		)
		.action(async (options: { out?: string; kind?: string }) => {
			const kind = options.kind as ResourceKind | undefined;
			if (kind !== undefined && !KINDS.includes(kind)) {
				throw new CliExitError(
					`unknown template kind '${kind}' (expected one of ${KINDS.join(", ")})`,
				);
			}
			const workspace = deps.openWorkspace(deps.cwd);
			const selected = kind === undefined ? KINDS : [kind];

			if (options.out !== undefined) {
				const dir = resolve(deps.cwd, options.out);
				await mkdir(dir, { recursive: true });
				for (const each of selected) {
					const path = join(dir, TEMPLATE_FILES[each]);
					await writeFile(path, await workspace.template(each));
					deps.stdout(`  wrote ${path}\n`);
				}
				return;
			}
			if (kind !== undefined) {
				deps.stdout(await workspace.template(kind));
				return;
			}
			deps.stdout("Shipped templates:\n");
			for (const each of KINDS) deps.stdout(`  ${each.padEnd(10)} ${TEMPLATE_FILES[each]}\n`);
			deps.stdout(
				"\nPrint one with `agent-evaluator templates --kind <kind>`, or write them all with --out <dir>.\n",
			);
		});
}
