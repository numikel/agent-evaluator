/** Client-side aggregation and formatting helpers for the run pages. All pure. */
import type { Action, RunSummary } from "@schemas/run";

export type ScenarioPassRate = {
	scenario: string;
	/** Every run of the scenario, whatever its status. */
	total: number;
	passed: number;
	failed: number;
	errored: number;
	/** `passed / (passed + failed)`; undefined until one run has a verdict. */
	rate: number | undefined;
};

/** Pass rate per scenario in first-seen order; runs without a verdict do not count. */
export function passRateByScenario(runs: readonly RunSummary[]): ScenarioPassRate[] {
	const byScenario = new Map<string, ScenarioPassRate>();
	for (const run of runs) {
		let entry = byScenario.get(run.scenario);
		if (!entry) {
			entry = {
				scenario: run.scenario,
				total: 0,
				passed: 0,
				failed: 0,
				errored: 0,
				rate: undefined,
			};
			byScenario.set(run.scenario, entry);
		}
		entry.total += 1;
		if (run.status === "PASSED") entry.passed += 1;
		else if (run.status === "FAILED") entry.failed += 1;
		else if (run.status === "ERROR") entry.errored += 1;
	}
	return [...byScenario.values()].map((entry) => {
		const judged = entry.passed + entry.failed;
		return { ...entry, rate: judged === 0 ? undefined : entry.passed / judged };
	});
}

/** Newest first by `started_at`, at most `limit` entries. */
export function recentRuns(runs: readonly RunSummary[], limit: number): RunSummary[] {
	return runs
		.slice()
		.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
		.slice(0, limit);
}

export function runDurationMs(
	startedAt: string | undefined,
	finishedAt: string | undefined,
): number | undefined {
	if (!startedAt || !finishedAt) return undefined;
	const ms = Date.parse(finishedAt) - Date.parse(startedAt);
	return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

/** `4m 12s`, `59s`, `1h 2m`; an em dash for unknown. */
export function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "—";
	const seconds = Math.floor(ms / 1000);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${rest}s`;
	return `${rest}s`;
}

export function formatLatency(ms: number | undefined): string {
	if (ms === undefined) return "";
	return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(iso: string | undefined): string {
	if (!iso) return "—";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const quote = (text: string): string => {
	const trimmed = text.length > 60 ? `${text.slice(0, 57)}…` : text;
	return `"${trimmed}"`;
};

/** One-line human label of a simulator action for thumbnails and the step panel. */
export function describeAction(action: Action): string {
	switch (action.kind) {
		case "open":
			return `open ${action.url}`;
		case "snapshot":
		case "read_conversation":
		case "screenshot_view":
			return action.kind.replace(/_/g, " ");
		case "click":
			return `click ${action.ref}`;
		case "type":
			return `type ${quote(action.text)} into ${action.ref}${action.submit ? " and submit" : ""}`;
		case "press":
			return `press ${action.key}`;
		case "scroll":
			return `scroll ${action.direction} ${action.amount}`;
		case "wait":
			return `wait ${action.ms} ms`;
		case "send_message":
			return `send ${quote(action.text)}`;
		case "download":
			return `download ${action.ref}`;
		case "upload":
			return `upload ${action.file} to ${action.ref}`;
		case "click_at":
			return `click at ${action.x},${action.y}`;
		case "type_at":
			return `type ${quote(action.text)} at ${action.x},${action.y}`;
		case "end_conversation":
			return `end conversation (${action.reason})`;
	}
}
