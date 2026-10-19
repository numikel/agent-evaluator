/**
 * Pure state for the run detail page. `applyRunEvent` folds one `RunEvent` into the view state;
 * it is idempotent for replays (the server resends `events.jsonl` on every SSE connection), so
 * collections are keyed: steps by index, criteria by id, downloads by path, messages by
 * (turn, role, at). `fromDetail` seeds the same state from `GET /api/runs/:id` for finished runs.
 */
import type { RunDetail } from "@schemas/api";
import type {
	CriterionResult,
	DownloadArtifact,
	RunEvent,
	RunRecord,
	RunStatus,
	Step,
	TranscriptEntry,
	Verdict,
} from "@schemas/run";

export type LogLine = { level: "debug" | "info" | "warn"; message: string; at: string };

export type RunViewState = {
	runId: string;
	run: RunRecord | undefined;
	status: RunStatus;
	/** Current conversation turn (0 before the first user message). */
	turn: number;
	maxTurns: number | undefined;
	startedAt: string | undefined;
	finishedAt: string | undefined;
	steps: Step[];
	transcript: TranscriptEntry[];
	downloads: DownloadArtifact[];
	/** Criteria announced by `judge_started`, in scoring order. */
	criteriaIds: string[];
	criteria: CriterionResult[];
	verdict: Verdict | undefined;
	/** Report path relative to the run dir (`report.html`) once it exists. */
	report: string | undefined;
	/** Non-fatal error messages, in order. */
	errors: string[];
	fatalError: string | undefined;
	logs: LogLine[];
};

const MAX_LOGS = 200;
const TERMINAL: ReadonlySet<RunStatus> = new Set(["PASSED", "FAILED", "ERROR"]);

export const isTerminalStatus = (status: RunStatus): boolean => TERMINAL.has(status);

export function initialRunState(runId: string): RunViewState {
	return {
		runId,
		run: undefined,
		status: "PENDING",
		turn: 0,
		maxTurns: undefined,
		startedAt: undefined,
		finishedAt: undefined,
		steps: [],
		transcript: [],
		downloads: [],
		criteriaIds: [],
		criteria: [],
		verdict: undefined,
		report: undefined,
		errors: [],
		fatalError: undefined,
		logs: [],
	};
}

/** Replaces the element with the same key or appends; returns a new array. */
function upsert<T>(items: readonly T[], item: T, key: (x: T) => string | number): T[] {
	const k = key(item);
	const index = items.findIndex((x) => key(x) === k);
	if (index === -1) return [...items, item];
	const next = items.slice();
	next[index] = item;
	return next;
}

/** Keeps criteria in the order `judge_started` announced them; unknown ids go last. */
function orderCriteria(criteria: CriterionResult[], ids: readonly string[]): CriterionResult[] {
	if (ids.length === 0) return criteria;
	const rank = new Map(ids.map((id, i) => [id, i]));
	return criteria
		.slice()
		.sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length));
}

const messageKey = (m: TranscriptEntry) => `${m.turn}:${m.role}:${m.at}`;

function withStatus(state: RunViewState, status: RunStatus, at: string): RunViewState {
	const finishedAt =
		isTerminalStatus(status) && state.finishedAt === undefined ? at : state.finishedAt;
	return { ...state, status, finishedAt };
}

export function applyRunEvent(state: RunViewState, event: RunEvent): RunViewState {
	switch (event.type) {
		case "run_started": {
			const { run } = event;
			return {
				...withStatus(state, run.status, event.at),
				run,
				turn: run.turns_used,
				maxTurns: run.max_turns,
				startedAt: run.started_at,
				finishedAt: run.finished_at ?? state.finishedAt,
				fatalError: run.error ?? state.fatalError,
			};
		}
		case "status":
			return withStatus(state, event.status, event.at);
		case "step":
			return {
				...state,
				steps: upsert(state.steps, event.step, (s) => s.index).sort((a, b) => a.index - b.index),
			};
		case "turn":
			return { ...state, turn: event.turn, maxTurns: event.max_turns };
		case "message":
			return { ...state, transcript: upsert(state.transcript, event.entry, messageKey) };
		case "download":
			return { ...state, downloads: upsert(state.downloads, event.artifact, (d) => d.path) };
		case "judge_started":
			return {
				...state,
				criteriaIds: event.criteria,
				criteria: orderCriteria(state.criteria, event.criteria),
			};
		case "criterion":
			return {
				...state,
				criteria: orderCriteria(
					upsert(state.criteria, event.result, (c) => c.id),
					state.criteriaIds,
				),
			};
		case "done": {
			const { verdict } = event;
			let criteria = state.criteria;
			for (const result of verdict.criteria) criteria = upsert(criteria, result, (c) => c.id);
			return {
				...withStatus(state, verdict.status, event.at),
				verdict,
				report: event.report ?? state.report,
				criteria: orderCriteria(criteria, state.criteriaIds),
				turn: verdict.turns_used,
				maxTurns: verdict.max_turns,
			};
		}
		case "error":
			if (!event.fatal) return { ...state, errors: [...state.errors, event.message] };
			return { ...withStatus(state, "ERROR", event.at), fatalError: event.message };
		case "log": {
			const line: LogLine = { level: event.level, message: event.message, at: event.at };
			const logs = state.logs.length >= MAX_LOGS ? state.logs.slice(1) : state.logs;
			return { ...state, logs: [...logs, line] };
		}
	}
}

/** Seeds the view from the stored record (and verdict) of a run, as `GET /api/runs/:id` returns it. */
export function fromDetail(detail: RunDetail): RunViewState {
	const { run, verdict } = detail;
	const base = initialRunState(run.id);
	return {
		...base,
		run,
		status: run.status,
		turn: verdict?.turns_used ?? run.turns_used,
		maxTurns: run.max_turns,
		startedAt: run.started_at,
		finishedAt: run.finished_at,
		criteria: verdict?.criteria ?? [],
		criteriaIds: verdict?.criteria.map((c) => c.id) ?? [],
		verdict,
		report: detail.has_report ? "report.html" : undefined,
		fatalError: run.error,
	};
}
