/**
 * `RunStore`-backed `StepRecorder` (P10): every simulator tool call becomes `steps/NNN/` on disk
 * (before/after/interim PNGs, snapshot.txt, action.json) and a `step` event once it is closed.
 * Console messages drained after each step are tagged with the step index.
 */

import type { BeginStepOptions, StepOutcome, StepRecorder } from "../agents/simulator/recorder.js";
import type { ConsoleMessage } from "../browser/types.js";
import type { Action, ConsoleEntry, RunEvent, Step } from "../schemas/index.js";
import type { RunStore } from "../workspace/types.js";

export type RunStoreStepRecorderOptions = {
	runStore: RunStore;
	runId: string;
	/** Receives the `step` event after `action.json` is written. */
	emit: (event: RunEvent) => void;
	/** Console messages collected since the previous step; appended to `console.jsonl`. */
	drainConsole?: () => ConsoleMessage[];
	/** Forces every step onto this turn (login pass = 0); otherwise the simulator's turn is kept. */
	turnOverride?: number;
	now?: () => Date;
};

type OpenStep = { step: Step; startedAt: number };

export class RunStoreStepRecorder implements StepRecorder {
	/** While set, every new step is recorded on this turn (the login pass uses 0). */
	turnOverride: number | undefined;
	private readonly open = new Map<number, OpenStep>();
	private nextIndex = 1;
	private readonly now: () => Date;

	constructor(private readonly options: RunStoreStepRecorderOptions) {
		this.now = options.now ?? (() => new Date());
		this.turnOverride = options.turnOverride;
	}

	/** Index the next `begin` will use. */
	get nextStepIndex(): number {
		return this.nextIndex;
	}

	async begin(action: Action, options: BeginStepOptions = {}): Promise<number> {
		const index = this.nextIndex++;
		const step: Step = {
			index,
			turn: this.turnOverride ?? options.turn ?? 0,
			action,
			started_at: this.now().toISOString(),
			interim_screenshots: [],
		};
		if (options.thought !== undefined) step.thought = options.thought;
		this.open.set(index, { step, startedAt: performance.now() });
		return index;
	}

	private get(stepId: number): OpenStep {
		const open = this.open.get(stepId);
		if (!open) throw new Error(`RunStoreStepRecorder: step ${stepId} is not open`);
		return open;
	}

	async attachBefore(stepId: number, png: Uint8Array): Promise<void> {
		const { step } = this.get(stepId);
		step.screenshot_before = await this.options.runStore.saveScreenshot(
			this.options.runId,
			stepId,
			"before",
			png,
		);
	}

	async attachAfter(stepId: number, png: Uint8Array): Promise<void> {
		const { step } = this.get(stepId);
		step.screenshot = await this.options.runStore.saveScreenshot(
			this.options.runId,
			stepId,
			"after",
			png,
		);
	}

	async attachSnapshot(stepId: number, tree: string): Promise<void> {
		const { step } = this.get(stepId);
		step.snapshot = await this.options.runStore.saveSnapshot(this.options.runId, stepId, tree);
	}

	async attachInterim(stepId: number, png: Uint8Array): Promise<void> {
		const { step } = this.get(stepId);
		const path = await this.options.runStore.saveScreenshot(
			this.options.runId,
			stepId,
			`interim-${step.interim_screenshots.length + 1}`,
			png,
		);
		step.interim_screenshots.push(path);
	}

	async end(stepId: number, outcome: StepOutcome): Promise<Step> {
		const { step, startedAt } = this.get(stepId);
		this.open.delete(stepId);
		step.duration_ms = Math.max(0, Math.round(performance.now() - startedAt));
		if (outcome.error !== undefined) step.error = outcome.error;
		else step.result = outcome.result;
		await this.options.runStore.saveStep(this.options.runId, step);
		await this.flushConsole(stepId);
		this.options.emit({
			type: "step",
			runId: this.options.runId,
			at: this.now().toISOString(),
			step,
		});
		return step;
	}

	private async flushConsole(stepId: number): Promise<void> {
		const messages = this.options.drainConsole?.() ?? [];
		if (messages.length === 0) return;
		const entries: ConsoleEntry[] = messages.map((m) => ({
			level: m.level,
			text: m.text,
			at: m.at,
			step: stepId,
		}));
		await this.options.runStore.appendConsole(this.options.runId, entries);
	}
}
