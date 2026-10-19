/**
 * FROZEN CONTRACT (P0). The runner orchestrates one scenario execution and emits `RunEvent`s.
 * Implemented in P10; the server (P8), CLI (P11) and UI (P12b) program against this interface.
 */
import type { RunEvent, RunSummary, StartRunRequest } from "../schemas/index.js";

export type { RunEvent };

export type RunEventListener = (event: RunEvent) => void;

export type Unsubscribe = () => void;

export interface Runner {
	/** Starts one or more runs (scenario.repeat × request.repeat) and returns their ids immediately. */
	start(request: StartRunRequest): Promise<{ runIds: string[] }>;
	cancel(runId: string): Promise<void>;
	/** Subscribes to live events of a run; past events are not replayed (read `events.jsonl` for history). */
	subscribe(runId: string, listener: RunEventListener): Unsubscribe;
	/** Runs currently in flight. */
	active(): Promise<RunSummary[]>;
}

/** Thrown by `Runner.start` when the workspace cannot resolve the scenario or models are unavailable. */
export class RunPreconditionError extends Error {
	override readonly name = "RunPreconditionError";
}
