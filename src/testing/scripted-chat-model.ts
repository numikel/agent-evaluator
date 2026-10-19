import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
	BaseChatModel,
	type BaseChatModelParams,
	type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { RunnableLambda } from "@langchain/core/runnables";

export type ToolCallScript = { name: string; args: Record<string, unknown>; id?: string };

/** One scripted model turn: plain text, text + tool calls, or a function computing the reply from the prompt. */
export type ScriptedTurn =
	| string
	| { text?: string; toolCalls?: ToolCallScript[] }
	| ((
			messages: BaseMessage[],
			call: number,
	  ) => string | { text?: string; toolCalls?: ToolCallScript[] });

export type ScriptedChatModelFields = BaseChatModelParams & {
	/** Replies returned in order; the last one repeats when the script is exhausted. */
	script: ScriptedTurn[];
	/** Objects returned, in order, by `withStructuredOutput(...)` runnables. */
	structured?: unknown[];
	/** Fail loudly instead of repeating the last turn once the script is exhausted. */
	strict?: boolean;
};

let idCounter = 0;

/**
 * Deterministic chat model for unit tests. Works with `createAgent` (tool round-trips via scripted
 * `toolCalls`), `withStructuredOutput` (scripted objects) and records every prompt it received in
 * `calls` so tests can assert on what the agent sent (system prompt, image blocks, tool results).
 */
export class ScriptedChatModel extends BaseChatModel {
	readonly script: ScriptedTurn[];
	readonly structured: unknown[];
	readonly strict: boolean;
	/** Every message list the model was invoked with, in order. */
	readonly calls: BaseMessage[][] = [];
	/** Tools bound via `bindTools`, in order of binding. */
	readonly boundTools: BindToolsInput[] = [];
	private structuredIndex = 0;

	constructor(fields: ScriptedChatModelFields) {
		const { script, structured, strict, ...rest } = fields;
		super(rest);
		this.script = script;
		this.structured = structured ?? [];
		this.strict = strict ?? false;
	}

	_llmType(): string {
		return "scripted";
	}

	override bindTools(tools: BindToolsInput[]): this {
		this.boundTools.push(...tools);
		return this;
	}

	override withStructuredOutput<T extends Record<string, unknown>>(): RunnableLambda<unknown, T> {
		return RunnableLambda.from(async (input: unknown) => {
			if (Array.isArray(input)) this.calls.push(input as BaseMessage[]);
			const next = this.structured[this.structuredIndex];
			if (next === undefined) throw new Error("ScriptedChatModel: structured script exhausted");
			this.structuredIndex += 1;
			return next as T;
		});
	}

	/** Names of all bound tools (StructuredTool instances or OpenAI-style function specs). */
	boundToolNames(): string[] {
		return this.boundTools
			.map((t) => {
				if (typeof t !== "object" || t === null) return "";
				if ("name" in t && typeof t.name === "string") return t.name;
				if (
					"function" in t &&
					typeof t.function === "object" &&
					t.function &&
					"name" in t.function
				) {
					return String((t.function as { name: string }).name);
				}
				return "";
			})
			.filter((n) => n.length > 0);
	}

	/** Number of generate calls so far. */
	get callCount(): number {
		return this.calls.length;
	}

	async _generate(
		messages: BaseMessage[],
		_options?: this["ParsedCallOptions"],
		_runManager?: CallbackManagerForLLMRun,
	): Promise<ChatResult> {
		const callIndex = this.calls.length;
		this.calls.push(messages);
		let turn = this.script[callIndex];
		if (turn === undefined) {
			if (this.strict || this.script.length === 0) {
				throw new Error(`ScriptedChatModel: script exhausted at call #${callIndex + 1}`);
			}
			turn = this.script[this.script.length - 1] as ScriptedTurn;
		}
		const resolved = typeof turn === "function" ? turn(messages, callIndex) : turn;
		const spec = typeof resolved === "string" ? { text: resolved } : resolved;
		const message = new AIMessage({
			content: spec.text ?? "",
			tool_calls: (spec.toolCalls ?? []).map((tc) => ({
				name: tc.name,
				args: tc.args,
				id: tc.id ?? `call_${++idCounter}`,
				type: "tool_call" as const,
			})),
		});
		return { generations: [{ text: spec.text ?? "", message }] };
	}
}
