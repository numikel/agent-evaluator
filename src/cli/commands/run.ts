import { type Command, InvalidArgumentError } from "commander";
import { actionLabel, type ReportSummary } from "../../report/index.js";
import type { RunnerLogger } from "../../runner/index.js";
import type { RunEvent, RunRecord, StartRunRequest } from "../../schemas/index.js";
import type { ResolvedScenario, RunStore } from "../../workspace/types.js";
import { openContext } from "../context.js";
import type { CliDeps } from "../deps.js";
import {
	CHECK,
	CliExitError,
	CROSS,
	createPalette,
	formatBytes,
	formatPercent,
	formatTable,
	type Palette,
	plural,
	truncate,
} from "../output.js";

const REPORT_FILE = "report.html";
const SUMMARY_FILE = "summary.json";

/** Runner logger that keeps warnings and errors on stderr and drops the chatter. */
export function runnerLogger(deps: CliDeps): RunnerLogger {
	return {
		info: () => undefined,
		warn: (message) => deps.stderr(`warn: ${message}\n`),
		error: (message) => deps.stderr(`error: ${message}\n`),
	};
}

export function parsePositiveInt(value: string): number {
	if (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
		throw new InvalidArgumentError("must be a positive integer");
	}
	return Number.parseInt(value, 10);
}

/** Formats one runner event as a progress line for stderr; `undefined` means nothing to print. */
export function formatEvent(event: RunEvent, palette: Palette): string | undefined {
	const { green, red, yellow, cyan, bold } = palette;
	switch (event.type) {
		case "run_started": {
			const { run } = event;
			return `${cyan("started")} ${run.scenario} (${run.repeat_index}/${run.repeat_total}) persona=${run.persona} target=${run.target}`;
		}
		case "status":
			return event.status === "JUDGING" ? cyan("judging…") : undefined;
		case "turn":
			return bold(`turn ${event.turn}/${event.max_turns}`);
		case "step": {
			const { step } = event;
			const label = `  step ${step.index}: ${actionLabel(step)}`;
			return step.error ? `${label} ${red(`${CROSS} ${truncate(step.error, 80)}`)}` : label;
		}
		case "message": {
			const { entry } = event;
			return `  ${entry.role}: ${truncate(entry.text, 100)}`;
		}
		case "download":
			return `  download ${event.artifact.filename} (${formatBytes(event.artifact.bytes)})`;
		case "judge_started":
			return cyan(`judging ${plural(event.criteria.length, "criterion", "criteria")}`);
		case "criterion": {
			const { result } = event;
			const mark = result.pass ? green(CHECK) : red(CROSS);
			const required = result.required ? " (required)" : "";
			const reason = result.pass ? "" : ` — ${truncate(result.reason, 80)}`;
			return `  ${mark} ${result.id} ${result.score.toFixed(2)}${required}${reason}`;
		}
		case "done": {
			const { verdict } = event;
			const paint = verdict.status === "PASSED" ? green : red;
			return paint(
				`${verdict.status} ${formatPercent(verdict.score)} (turns ${verdict.turns_used}/${verdict.max_turns})`,
			);
		}
		case "error":
			return red(`error: ${event.message}`);
		case "log":
			return event.level === "warn" ? yellow(`warn: ${event.message}`) : undefined;
	}
}

type RunOptions = {
	target?: string;
	repeat?: number;
	headed?: boolean;
	json?: boolean;
	failOnError?: boolean;
	workspace?: string;
};

type JsonSummary = ReportSummary & { error?: string };

const decoder = new TextDecoder();

async function readSummary(
	runStore: RunStore,
	record: RunRecord,
	resolved: ResolvedScenario | undefined,
): Promise<JsonSummary> {
	if (record.status === "PASSED" || record.status === "FAILED") {
		try {
			return JSON.parse(decoder.decode(await runStore.readFile(record.id, SUMMARY_FILE)));
		} catch {
			// Fall through to the synthesized summary (report missing or unreadable).
		}
	}
	const summary: JsonSummary = {
		runId: record.id,
		scenario: record.scenario,
		status: record.status === "PASSED" || record.status === "FAILED" ? record.status : "ERROR",
		score: record.score ?? 0,
		percent: Math.round((record.score ?? 0) * 100),
		pass_threshold: resolved?.rubric.pass_threshold ?? 0,
		goal_reached: false,
		turns_used: record.turns_used,
		max_turns: record.max_turns,
		criteria: [],
		started_at: record.started_at,
	};
	if (record.finished_at !== undefined) summary.finished_at = record.finished_at;
	if (record.error !== undefined) summary.error = record.error;
	return summary;
}

function statusCell(status: RunRecord["status"], palette: Palette): string {
	if (status === "PASSED") return palette.green(status);
	if (status === "FAILED") return palette.red(status);
	if (status === "ERROR") return palette.red(status);
	return palette.yellow(status);
}

export function registerRun(program: Command, deps: CliDeps): void {
	program
		.command("run")
		.description("Run scenarios headless, stream progress to stderr and summarise on stdout")
		.argument("<scenario...>", "scenario name(s) from scenarios/")
		.option("-t, --target <name>", "override the scenario's target")
		.option(
			"-r, --repeat <n>",
			"run each scenario n times (multiplied by scenario.repeat)",
			parsePositiveInt,
		)
		.option("--headed", "show the browser window")
		.option("--json", "print the summary.json objects as a JSON array instead of the table")
		.option("--fail-on-error", "stop early: cancel the runs still pending once a run ends in ERROR")
		.option("-w, --workspace <dir>", "workspace directory (default: current directory)")
		.action(async (scenarios: string[], options: RunOptions) => {
			const palette = createPalette(deps.color);
			const ctx = await openContext(deps, { workspace: options.workspace });

			// Resolve everything first so a typo starts nothing (and writes nothing).
			const resolved = new Map<string, ResolvedScenario>();
			for (const name of scenarios) {
				if (resolved.has(name)) continue;
				try {
					resolved.set(
						name,
						await ctx.workspace.resolve(
							name,
							options.target ? { target: options.target } : undefined,
						),
					);
				} catch (error) {
					throw new CliExitError(
						`cannot run '${name}': ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			const runner = deps.createRunner({
				workspace: ctx.workspace,
				runStore: ctx.runStore,
				logger: runnerLogger(deps),
			});
			const unsubscribe: Array<() => void> = [];
			const records = new Map<string, RunRecord>();
			const runIds: string[] = [];
			try {
				for (const name of scenarios) {
					const request: StartRunRequest = { scenario: name };
					if (options.target !== undefined) request.target = options.target;
					if (options.repeat !== undefined) request.repeat = options.repeat;
					if (options.headed) request.headless = false;
					const started = await runner.start(request);
					for (const id of started.runIds) {
						runIds.push(id);
						unsubscribe.push(
							runner.subscribe(id, (event) => {
								const line = formatEvent(event, palette);
								if (line !== undefined) deps.stderr(`${palette.dim(`[${id}]`)} ${line}\n`);
							}),
						);
					}
				}

				let cancelling = false;
				await Promise.all(
					runIds.map(async (id) => {
						const record = await runner.wait(id);
						records.set(id, record);
						if (options.failOnError && record.status === "ERROR" && !cancelling) {
							cancelling = true;
							deps.stderr(
								palette.yellow(
									`run ${id} ended in ERROR; cancelling the remaining runs (--fail-on-error)\n`,
								),
							);
							for (const other of runIds) if (!records.has(other)) await runner.cancel(other);
						}
					}),
				);
			} finally {
				for (const off of unsubscribe) off();
				await runner.close();
			}

			const finals = runIds.map((id) => records.get(id)).filter((r): r is RunRecord => !!r);
			const passed = finals.filter((r) => r.status === "PASSED").length;
			const failed = finals.filter((r) => r.status === "FAILED").length;
			const errors = finals.length - passed - failed;

			if (options.json) {
				const summaries = await Promise.all(
					finals.map((record) => readSummary(ctx.runStore, record, resolved.get(record.scenario))),
				);
				deps.stdout(`${JSON.stringify(summaries, null, 2)}\n`);
			} else {
				const rows = finals.map((record) => [
					record.scenario,
					statusCell(record.status, palette),
					formatPercent(record.score),
					`${record.turns_used}/${record.max_turns}`,
					record.status === "PASSED" || record.status === "FAILED"
						? ctx.runStore.artifactPath(record.id, REPORT_FILE)
						: `error: ${truncate(record.error ?? "unknown", 80)}`,
				]);
				deps.stdout(`${formatTable(["Scenario", "Status", "Score", "Turns", "Report"], rows)}\n`);
				deps.stdout(
					`\n${plural(finals.length, "run")}: ${passed} passed, ${failed} failed, ${plural(errors, "error")}\n`,
				);
			}

			if (failed + errors > 0) {
				throw new CliExitError(
					`${failed} failed, ${plural(errors, "error")} out of ${plural(finals.length, "run")}`,
				);
			}
		});
}
