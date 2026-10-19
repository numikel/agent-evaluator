import type { ScreenshotResult } from "../../browser/types.js";
import type { TranscriptEntry } from "../../schemas/index.js";

export type EndReason = "goal_reached" | "gave_up" | "blocked";
export type StopReason = EndReason | "max_turns" | "error";

/**
 * Mutable state shared by the tools, the middleware and the run loop of one simulator run.
 * It lives outside the LangGraph state on purpose: tools and middleware mutate it directly.
 */
export type ConversationState = {
	readonly maxTurns: number;
	/** Successful `send_message` calls so far. */
	turnsUsed: number;
	/** Set by `end_conversation`; the middleware stops the agent before the next model call. */
	ended: { reason: EndReason; summary: string } | undefined;
	/** Set by the turn-budget middleware when the model kept going after the last turn. */
	stopped: { reason: StopReason; summary: string } | undefined;
	transcript: TranscriptEntry[];
	/** Latest accessibility tree seen by any tool. */
	latestTree: string | undefined;
	/** Latest `screenshot_view` capture, consumed by the vision middleware. */
	pendingScreenshot: ScreenshotResult | undefined;
};

export function createConversationState(maxTurns: number): ConversationState {
	return {
		maxTurns,
		turnsUsed: 0,
		ended: undefined,
		stopped: undefined,
		transcript: [],
		latestTree: undefined,
		pendingScreenshot: undefined,
	};
}
