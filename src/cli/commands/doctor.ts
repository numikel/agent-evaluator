import type { Command } from "commander";
import { runDoctor } from "../../config/index.js";
import type { DoctorCheck } from "../../config/types.js";
import { openContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { CHECK, CliExitError, CROSS, createPalette, plural } from "../output.js";

/** A failed check blocks runs when it concerns a configured model role or the browser. */
export function isBlocking(check: DoctorCheck): boolean {
	return !check.ok && (check.id.startsWith("model:") || check.id === "browser:chromium");
}

export function registerDoctor(program: Command, deps: CliDeps): void {
	program
		.command("doctor")
		.description("Check providers, Chromium, the workspace layout and the configured models")
		.option("-w, --workspace <dir>", "workspace directory (default: current directory)")
		.action(async (options: { workspace?: string }) => {
			const palette = createPalette(deps.color);
			const ctx = await openContext(deps, { workspace: options.workspace });
			const checks = await runDoctor({
				secrets: deps.secrets,
				settings: ctx.settings,
				workspaceRoot: ctx.root,
				registry: deps.providers,
				exists: deps.exists,
				chromiumExecutablePath: deps.chromiumExecutablePath,
			});

			const width = Math.max(...checks.map((c) => c.label.length));
			for (const check of checks) {
				const mark = check.ok
					? palette.green(CHECK)
					: isBlocking(check)
						? palette.red(CROSS)
						: palette.yellow(CROSS);
				deps.stdout(`${mark} ${check.label.padEnd(width)}  ${check.detail ?? ""}\n`);
				if (!check.ok && check.fix) deps.stdout(`    fix: ${check.fix}\n`);
			}

			const blocking = checks.filter(isBlocking);
			if (blocking.length > 0) {
				throw new CliExitError(
					`${plural(blocking.length, "blocking problem")} found; fix the ${CROSS} items above`,
				);
			}
			deps.stdout(`\nAll required checks passed (${ctx.root}).\n`);
		});
}
