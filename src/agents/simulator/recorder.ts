import type { Action, Step } from "../../schemas/index.js";

export type StepOutcome =
	| { result: string; error?: undefined }
	| { error: string; result?: undefined };

export type BeginStepOptions = {
	/** Conversation turn the step belongs to (0 = pre-conversation setup). */
	turn?: number;
	/** Short model reasoning / tool-call summary, if available. */
	thought?: string;
};

/**
 * Sink for step evidence. Every simulator tool call goes through `begin` → attach* → `end`.
 * `InMemoryStepRecorder` keeps everything in memory for tests; the runner (P10) provides a
 * `RunStore`-backed implementation that writes `steps/NNN/…` to disk and emits `step` events.
 */
export interface StepRecorder {
	/** Opens a new step and returns its id (the 1-based step index). */
	begin(action: Action, options?: BeginStepOptions): Promise<number>;
	attachBefore(stepId: number, png: Uint8Array): Promise<void>;
	attachAfter(stepId: number, png: Uint8Array): Promise<void>;
	attachSnapshot(stepId: number, tree: string): Promise<void>;
	attachInterim(stepId: number, png: Uint8Array): Promise<void>;
	/** Closes the step with the (already truncated) tool result or error and returns the record. */
	end(stepId: number, outcome: StepOutcome): Promise<Step>;
}

export function stepDir(stepId: number): string {
	return `steps/${String(stepId).padStart(3, "0")}`;
}

type OpenStep = {
	step: Step;
	startedAt: number;
};

/** Keeps steps and their attachments in memory; paths mirror the on-disk run layout. */
export class InMemoryStepRecorder implements StepRecorder {
	/** Completed steps in order. */
	readonly steps: Step[] = [];
	/** Attachment contents keyed by their run-relative path (PNG bytes or snapshot text). */
	readonly files = new Map<string, Uint8Array | string>();
	private readonly open = new Map<number, OpenStep>();
	private nextIndex = 1;

	async begin(action: Action, options: BeginStepOptions = {}): Promise<number> {
		const index = this.nextIndex++;
		const step: Step = {
			index,
			turn: options.turn ?? 0,
			action,
			started_at: new Date().toISOString(),
			interim_screenshots: [],
		};
		if (options.thought !== undefined) step.thought = options.thought;
		this.open.set(index, { step, startedAt: performance.now() });
		return index;
	}

	private get(stepId: number): OpenStep {
		const open = this.open.get(stepId);
		if (!open) throw new Error(`InMemoryStepRecorder: step ${stepId} is not open`);
		return open;
	}

	async attachBefore(stepId: number, png: Uint8Array): Promise<void> {
		const path = `${stepDir(stepId)}/before.png`;
		this.files.set(path, png);
		this.get(stepId).step.screenshot_before = path;
	}

	async attachAfter(stepId: number, png: Uint8Array): Promise<void> {
		const path = `${stepDir(stepId)}/after.png`;
		this.files.set(path, png);
		this.get(stepId).step.screenshot = path;
	}

	async attachSnapshot(stepId: number, tree: string): Promise<void> {
		const path = `${stepDir(stepId)}/snapshot.txt`;
		this.files.set(path, tree);
		this.get(stepId).step.snapshot = path;
	}

	async attachInterim(stepId: number, png: Uint8Array): Promise<void> {
		const { step } = this.get(stepId);
		const path = `${stepDir(stepId)}/interim-${step.interim_screenshots.length + 1}.png`;
		this.files.set(path, png);
		step.interim_screenshots.push(path);
	}

	async end(stepId: number, outcome: StepOutcome): Promise<Step> {
		const { step, startedAt } = this.get(stepId);
		this.open.delete(stepId);
		step.duration_ms = Math.max(0, Math.round(performance.now() - startedAt));
		if (outcome.error !== undefined) step.error = outcome.error;
		else step.result = outcome.result;
		this.steps.push(step);
		return step;
	}
}
