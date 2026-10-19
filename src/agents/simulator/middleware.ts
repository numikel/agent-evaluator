import { AIMessage, createMiddleware, HumanMessage } from "langchain";
import type { ConversationState } from "./state.js";

/**
 * Vision mode: after a `screenshot_view` tool call, the PNG is appended to the model request as an
 * `image` content block inside a trailing `HumanMessage`. The block is added to the request only,
 * never persisted in the agent state and never placed inside a `ToolMessage`.
 */
export function visionMiddleware(state: ConversationState) {
	return createMiddleware({
		name: "simulatorVision",
		wrapModelCall: async (request, handler) => {
			const shot = state.pendingScreenshot;
			if (!shot) return handler(request);
			state.pendingScreenshot = undefined;
			const image = new HumanMessage({
				content: [
					{ type: "text", text: `Current screenshot of the page (${shot.width}x${shot.height}):` },
					{ type: "image", data: Buffer.from(shot.png).toString("base64"), mimeType: "image/png" },
				],
			});
			return handler({ ...request, messages: [...request.messages, image] });
		},
	});
}

export type TurnBudgetOptions = {
	state: ConversationState;
	/** Rebuilds the system prompt for the turn about to be played. */
	buildPrompt: (turn: number) => string;
};

/**
 * Turn budget enforcement:
 * - `wrapModelCall` refreshes the system prompt with the live "Turn k of N" counter;
 * - `beforeModel` ends the run as soon as `end_conversation` was called (no extra model call);
 * - `afterModel` ends the run with reason `max_turns` when the budget is used up and the model
 *   asked for anything other than `end_conversation` — so no further tool runs after the budget.
 */
export function turnBudgetMiddleware({ state, buildPrompt }: TurnBudgetOptions) {
	return createMiddleware({
		name: "simulatorTurnBudget",
		wrapModelCall: async (request, handler) => {
			const turn = Math.min(state.turnsUsed + 1, state.maxTurns);
			return handler({ ...request, systemPrompt: buildPrompt(turn) });
		},
		beforeModel: {
			canJumpTo: ["end"],
			hook: () => (state.ended || state.stopped ? { jumpTo: "end" } : undefined),
		},
		afterModel: {
			canJumpTo: ["end"],
			hook: (agentState) => {
				if (state.ended || state.turnsUsed < state.maxTurns) return undefined;
				const last = agentState.messages.at(-1);
				if (!AIMessage.isInstance(last)) return undefined;
				const calls = last.tool_calls ?? [];
				if (calls.length === 0 || calls.some((c) => c.name === "end_conversation")) {
					return undefined;
				}
				state.stopped = {
					reason: "max_turns",
					summary: `Reached the maximum of ${state.maxTurns} turns without ending the conversation.`,
				};
				return { jumpTo: "end" };
			},
		},
	});
}
