import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableInterface } from "@langchain/core/runnables";
import {
	type AnyAgentMiddleware,
	createAgent,
	HumanMessage,
	ToolCallLimitExceededError,
	toolCallLimitMiddleware,
} from "langchain";
import type { BrowserSession, DownloadResult } from "../../browser/types.js";
import type { Persona, Scenario, Target, TranscriptEntry } from "../../schemas/index.js";
import { turnBudgetMiddleware, visionMiddleware } from "./middleware.js";
import { buildSimulatorSystemPrompt } from "./prompt.js";
import type { StepRecorder } from "./recorder.js";
import { type ConversationState, createConversationState, type StopReason } from "./state.js";
import { createSimulatorTools } from "./tools.js";

/** Tool calls allowed per conversation turn before the run is declared blocked. */
export const TOOL_CALLS_PER_TURN = 8;

/** Any LangChain chat model (`initChatModel(...)`, `ScriptedChatModel`, …). */
export type SimulatorModel = RunnableInterface<BaseLanguageModelInput, BaseMessage>;

export type RunSimulatorOptions = {
	/** A `ResolvedScenario` or just the parts the simulator needs. */
	resolved: { scenario: Scenario; persona: Persona; target: Target };
	session: BrowserSession;
	model: SimulatorModel;
	recorder: StepRecorder;
	onMessage?: (entry: TranscriptEntry) => void | Promise<void>;
	onDownload?: (download: DownloadResult, stepId: number) => void | Promise<void>;
	signal?: AbortSignal;
};

export type SimulatorResult = {
	reason: StopReason;
	summary: string;
	turnsUsed: number;
	transcript: TranscriptEntry[];
	/** Set when `reason === "error"`. */
	error?: string;
};

type ToolCallLimitOptions = {
	toolName?: string;
	threadLimit?: number;
	runLimit?: number;
	exitBehavior?: "continue" | "error" | "end";
};

/**
 * `toolCallLimitMiddleware` is typed through `zod/v3` interop, which collapses to `never` under
 * zod 4 + `exactOptionalPropertyTypes`; the runtime API is the documented one, so we retype it.
 */
const toolCallLimit = toolCallLimitMiddleware as unknown as (
	options: ToolCallLimitOptions,
) => AnyAgentMiddleware;

function lastAssistantText(messages: BaseMessage[]): string {
	const last = messages.filter((m) => m.getType() === "ai").at(-1);
	if (!last) return "";
	return typeof last.content === "string" ? last.content.trim() : "";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function finish(state: ConversationState, fallbackSummary: string): SimulatorResult {
	const base = { turnsUsed: state.turnsUsed, transcript: state.transcript };
	if (state.ended) return { ...base, ...state.ended };
	if (state.stopped) return { ...base, ...state.stopped };
	if (state.turnsUsed >= state.maxTurns) {
		return {
			...base,
			reason: "max_turns",
			summary: `Reached the maximum of ${state.maxTurns} turns without ending the conversation.`,
		};
	}
	return {
		...base,
		reason: "gave_up",
		summary: fallbackSummary || "The simulator stopped without calling end_conversation.",
	};
}

/**
 * Runs the persona-driven simulator against an already opened page (the runner handles
 * `session.open(...)` and login beforehand). Resolves when the agent calls `end_conversation`,
 * the turn budget is exhausted, or an error stops the loop; it never throws for tool errors.
 */
export async function runSimulator(options: RunSimulatorOptions): Promise<SimulatorResult> {
	const { scenario, persona, target } = options.resolved;
	const vision = scenario.vision || target.vision;
	const state = createConversationState(scenario.max_turns);
	const buildPrompt = (turn: number) =>
		buildSimulatorSystemPrompt({
			persona,
			scenario,
			target,
			turn,
			maxTurns: scenario.max_turns,
			vision,
		});

	const toolOptions = {
		session: options.session,
		recorder: options.recorder,
		vision,
		state,
		timeouts: target.timeouts,
		...(options.onMessage ? { onMessage: options.onMessage } : {}),
		...(options.onDownload ? { onDownload: options.onDownload } : {}),
	};
	const tools = createSimulatorTools(toolOptions);
	const toolBudget = scenario.max_turns * TOOL_CALLS_PER_TURN;
	const middleware: AnyAgentMiddleware[] = [
		toolCallLimit({ threadLimit: toolBudget, exitBehavior: "error" }),
		turnBudgetMiddleware({ state, buildPrompt }),
		...(vision ? [visionMiddleware(state)] : []),
	];

	const agent = createAgent({
		model: options.model,
		tools,
		systemPrompt: buildPrompt(1),
		middleware,
	});

	try {
		const output = await agent.invoke(
			{ messages: [new HumanMessage("Begin the conversation.")] },
			{
				// every agent iteration is ~4 graph steps (before_model, model, after_model, tools)
				recursionLimit: (toolBudget + 2) * 4 + 8,
				...(options.signal ? { signal: options.signal } : {}),
			},
		);
		return finish(state, lastAssistantText(output.messages));
	} catch (error) {
		if (state.ended) return finish(state, "");
		if (error instanceof ToolCallLimitExceededError) {
			return {
				reason: "blocked",
				summary: `Tool-call budget exhausted (${toolBudget} calls for ${scenario.max_turns} turns) without ending the conversation.`,
				turnsUsed: state.turnsUsed,
				transcript: state.transcript,
			};
		}
		const message = errorMessage(error);
		return {
			reason: "error",
			summary: `Simulator failed: ${message}`,
			turnsUsed: state.turnsUsed,
			transcript: state.transcript,
			error: message,
		};
	}
}
