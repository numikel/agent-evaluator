import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { type ReportInput, ReportInputSchema, renderReport } from "../../report/index.js";
import { SCENARIO_SNAPSHOT_FILE } from "../../runner/index.js";
import { PersonaSchema, type RunRecord } from "../../schemas/index.js";
import type { RunStore, Workspace } from "../../workspace/types.js";
import { openContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import { CliExitError } from "../output.js";

const REPORT_FILE = "report.html";
const decoder = new TextDecoder();

/**
 * The resolved scenario as the run saw it (`scenario.snapshot.yaml`), falling back to the
 * workspace's current files when the snapshot is missing.
 */
async function loadResolved(
	runStore: RunStore,
	workspace: Workspace,
	record: RunRecord,
): Promise<ReportInput["resolved"]> {
	try {
		const raw = decoder.decode(await runStore.readFile(record.id, SCENARIO_SNAPSHOT_FILE));
		const snapshot = parseYaml(raw) as Record<string, unknown>;
		const persona = PersonaSchema.parse(snapshot.persona);
		return ReportInputSchema.shape.resolved.parse({ ...snapshot, persona: persona.frontmatter });
	} catch {
		const resolved = await workspace.resolve(record.scenario, { target: record.target });
		return {
			scenario: resolved.scenario,
			persona: resolved.persona.frontmatter,
			target: resolved.target,
			rubric: resolved.rubric,
			evaluator: resolved.evaluator,
		};
	}
}

export function registerReport(program: Command, deps: CliDeps): void {
	program
		.command("report")
		.description("Re-render report.html, summary.json and junit.xml of a run from its artifacts")
		.argument("<runId>", "run directory name under the runs directory")
		.option("-w, --workspace <dir>", "workspace directory (default: current directory)")
		.option("--open", "open the rendered report in the browser")
		.action(async (runId: string, options: { workspace?: string; open?: boolean }) => {
			const ctx = await openContext(deps, { workspace: options.workspace });
			const { runStore } = ctx;

			let record: RunRecord;
			try {
				record = await runStore.readRecord(runId);
			} catch (error) {
				throw new CliExitError(
					`run '${runId}' not found in ${runStore.root} (${error instanceof Error ? error.message : String(error)})`,
				);
			}
			const verdict = await runStore.readVerdict(runId);
			if (!verdict) {
				throw new CliExitError(
					`run '${runId}' has no verdict (status ${record.status}); there is nothing to render`,
				);
			}

			const [steps, transcript, downloads, consoleEntries, resolved] = await Promise.all([
				runStore.readSteps(runId),
				runStore.readTranscript(runId),
				runStore.readDownloads(runId),
				runStore.readConsole(runId),
				loadResolved(runStore, ctx.workspace, record),
			]);
			const input = ReportInputSchema.parse({
				run: record,
				verdict,
				steps,
				transcript,
				downloads,
				console: consoleEntries,
				resolved,
			});
			const files = await renderReport(input, {
				inlineImages: true,
				imageLoader: async (relativePath) => {
					try {
						return await runStore.readFile(runId, relativePath);
					} catch {
						return undefined;
					}
				},
			});
			await runStore.saveReport(runId, files);

			const path = runStore.artifactPath(runId, REPORT_FILE);
			deps.stdout(`Rendered ${path}\n`);
			if (options.open) await deps.openUrl(pathToFileURL(path).href);
		});
}
