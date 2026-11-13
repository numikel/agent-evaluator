/**
 * Wire-level contract for the provider packages the factory builds models from. The real
 * `LangChainModelFactory` (real `initChatModel` and `ChatOpenRouter`) talks to a local HTTP server
 * that speaks the Anthropic Messages and OpenAI Chat Completions formats, so LangChain upgrades are
 * checked against what the simulator and the judge rely on: tool calls (invoked and streamed in
 * slices), structured output and the `createAgent` tool loop. Nothing leaves 127.0.0.1.
 */
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { type AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { createAgent, tool } from "langchain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LangChainModelFactory } from "./models.js";
import { StaticSecretsProvider } from "./secrets.js";

type Json = Record<string, unknown>;
type Recorded = { path: string; headers: IncomingHttpHeaders; body: Json };
type Reply = { kind: "tool"; name: string; args: Json } | { kind: "text"; text: string };

const KEY = "test-key-not-real";
/** Distinct per response: the agent state reducer merges messages that share an id. */
let responseCount = 0;
const SEND_ARGS = { text: "hello, world" };

/** Splits a JSON document in two so streamed tool-call arguments arrive as slices. */
function halves(value: Json): [string, string] {
	const json = JSON.stringify(value);
	const cut = Math.floor(json.length / 2);
	return [json.slice(0, cut), json.slice(cut)];
}

function decide(
	toolNames: string[],
	afterToolResult: boolean,
	wantsJson: boolean,
	args: Json,
): Reply {
	if (afterToolResult) return { kind: "text", text: "done" };
	const [name] = toolNames;
	if (name !== undefined) return { kind: "tool", name, args };
	return { kind: "text", text: wantsJson ? JSON.stringify(args) : "pong" };
}

function sse(res: ServerResponse, events: Array<[string | undefined, unknown]>): void {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	for (const [event, data] of events) {
		const payload = typeof data === "string" ? data : JSON.stringify(data);
		res.write(`${event ? `event: ${event}\n` : ""}data: ${payload}\n\n`);
	}
	res.end();
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function anthropic(body: Json, res: ServerResponse, args: Json): void {
	const tools = (body.tools as Array<{ name: string }> | undefined) ?? [];
	const messages = (body.messages as Array<{ content: unknown }> | undefined) ?? [];
	const last = messages.at(-1)?.content;
	const afterToolResult =
		Array.isArray(last) && last.some((part) => (part as Json).type === "tool_result");
	const wantsJson = body.output_format !== undefined || body.output_config !== undefined;
	const reply = decide(
		tools.map((t) => t.name),
		afterToolResult,
		wantsJson,
		args,
	);
	const base = {
		id: `msg_${++responseCount}`,
		type: "message",
		role: "assistant",
		model: body.model,
	};
	const usage = { input_tokens: 10, output_tokens: 5 };
	const stopReason = reply.kind === "tool" ? "tool_use" : "end_turn";
	if (body.stream !== true) {
		const content =
			reply.kind === "tool"
				? [{ type: "tool_use", id: "toolu_1", name: reply.name, input: reply.args }]
				: [{ type: "text", text: reply.text }];
		json(res, 200, { ...base, content, stop_reason: stopReason, stop_sequence: null, usage });
		return;
	}
	const block =
		reply.kind === "tool"
			? { type: "tool_use", id: "toolu_1", name: reply.name, input: {} }
			: { type: "text", text: "" };
	const deltas =
		reply.kind === "tool"
			? halves(reply.args).map((partial_json) => ({ type: "input_json_delta", partial_json }))
			: [{ type: "text_delta", text: reply.text }];
	sse(res, [
		[
			"message_start",
			{
				type: "message_start",
				message: { ...base, content: [], stop_reason: null, stop_sequence: null, usage },
			},
		],
		["content_block_start", { type: "content_block_start", index: 0, content_block: block }],
		...deltas.map((delta): [string, unknown] => [
			"content_block_delta",
			{ type: "content_block_delta", index: 0, delta },
		]),
		["content_block_stop", { type: "content_block_stop", index: 0 }],
		[
			"message_delta",
			{
				type: "message_delta",
				delta: { stop_reason: stopReason, stop_sequence: null },
				usage: { output_tokens: 5 },
			},
		],
		["message_stop", { type: "message_stop" }],
	]);
}

function openai(body: Json, res: ServerResponse, args: Json): void {
	const tools = (body.tools as Array<{ function?: { name: string } }> | undefined) ?? [];
	const messages = (body.messages as Array<{ role: string }> | undefined) ?? [];
	const format = (body.response_format as { type?: string } | undefined)?.type;
	const reply = decide(
		tools.flatMap((t) => (t.function ? [t.function.name] : [])),
		messages.at(-1)?.role === "tool",
		format === "json_schema" || format === "json_object",
		args,
	);
	const base = { id: `chatcmpl-${++responseCount}`, created: 1, model: body.model };
	const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
	const finish = reply.kind === "tool" ? "tool_calls" : "stop";
	if (body.stream !== true) {
		const message =
			reply.kind === "tool"
				? {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: reply.name, arguments: JSON.stringify(reply.args) },
							},
						],
					}
				: { role: "assistant", content: reply.text };
		json(res, 200, {
			...base,
			object: "chat.completion",
			choices: [{ index: 0, message, finish_reason: finish, logprobs: null }],
			usage,
		});
		return;
	}
	const chunk = (delta: Json, finishReason: string | null = null): [undefined, unknown] => [
		undefined,
		{
			...base,
			object: "chat.completion.chunk",
			choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
		},
	];
	const deltas =
		reply.kind === "tool"
			? [
					chunk({
						role: "assistant",
						content: null,
						tool_calls: [
							{
								index: 0,
								id: "call_1",
								type: "function",
								function: { name: reply.name, arguments: "" },
							},
						],
					}),
					...halves(reply.args).map((slice) =>
						chunk({ tool_calls: [{ index: 0, function: { arguments: slice } }] }),
					),
				]
			: [chunk({ role: "assistant", content: reply.text })];
	const wantsUsage = (body.stream_options as Json | undefined)?.include_usage === true;
	sse(res, [
		...deltas,
		chunk({}, finish),
		...(wantsUsage
			? [
					[undefined, { ...base, object: "chat.completion.chunk", choices: [], usage }] as [
						undefined,
						unknown,
					],
				]
			: []),
		[undefined, "[DONE]"],
	]);
}

function startFakeProviders() {
	const state = { args: SEND_ARGS as Json, requests: [] as Recorded[], url: "" };
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const text = Buffer.concat(chunks).toString("utf8");
		const body = (text ? JSON.parse(text) : {}) as Json;
		const path = req.url ?? "";
		state.requests.push({ path, headers: req.headers, body });
		if (path.endsWith("/messages")) return anthropic(body, res, state.args);
		if (path.endsWith("/chat/completions")) return openai(body, res, state.args);
		json(res, 404, { error: { message: `fake provider has no route ${req.method} ${path}` } });
	});
	return {
		state,
		async start() {
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		},
		stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const fake = startFakeProviders();
beforeAll(() => fake.start());
afterAll(() => fake.stop());

const PROVIDERS = [
	{
		id: "anthropic",
		env: "ANTHROPIC_API_KEY",
		extra: (url: string): Json => ({ anthropicApiUrl: url }),
		auth: (h: IncomingHttpHeaders) => h["x-api-key"],
	},
	{
		id: "openai",
		env: "OPENAI_API_KEY",
		extra: (url: string): Json => ({ configuration: { baseURL: `${url}/v1` } }),
		auth: (h: IncomingHttpHeaders) => h.authorization,
	},
	{
		id: "openrouter",
		env: "OPENROUTER_API_KEY",
		extra: (url: string): Json => ({ baseURL: `${url}/v1` }),
		auth: (h: IncomingHttpHeaders) => h.authorization,
	},
	{
		id: "xai",
		env: "XAI_API_KEY",
		extra: (url: string): Json => ({ baseURL: `${url}/v1` }),
		auth: (h: IncomingHttpHeaders) => h.authorization,
	},
] as const;

const sendMessageSchema = z.object({ text: z.string().describe("Message to send") });

describe.each(PROVIDERS)("$id provider over the wire", (provider) => {
	const build = (): Promise<BaseChatModel> =>
		new LangChainModelFactory({
			secrets: new StaticSecretsProvider({ [provider.env]: KEY }),
		}).fromRef(`${provider.id}:contract-model`, { extra: provider.extra(fake.state.url) });

	const withSendMessage = async () => {
		const model = await build();
		if (!model.bindTools) throw new Error(`${provider.id} model cannot bind tools`);
		return model.bindTools([
			{ name: "send_message", description: "Send a chat message", schema: sendMessageSchema },
		]);
	};

	it("parses a tool call from invoke and sends the key from the secrets provider", async () => {
		fake.state.args = SEND_ARGS;
		fake.state.requests.length = 0;
		const reply = await (await withSendMessage()).invoke([new HumanMessage("hi")]);
		expect(reply.tool_calls).toEqual([
			expect.objectContaining({ name: "send_message", args: SEND_ARGS }),
		]);
		const [request] = fake.state.requests;
		expect(request?.body.stream).not.toBe(true);
		expect(String(provider.auth(request?.headers ?? {}))).toContain(KEY);
	});

	it("assembles a tool call whose arguments are streamed in slices", async () => {
		fake.state.args = SEND_ARGS;
		fake.state.requests.length = 0;
		let merged: AIMessageChunk | undefined;
		for await (const chunk of await (await withSendMessage()).stream([new HumanMessage("hi")])) {
			merged = merged ? merged.concat(chunk) : chunk;
		}
		expect(fake.state.requests[0]?.body.stream).toBe(true);
		expect(merged?.tool_calls).toEqual([
			expect.objectContaining({ name: "send_message", args: SEND_ARGS }),
		]);
	});

	it("returns structured output parsed against the schema", async () => {
		const verdict = { score: 0.8, reason: "polite and complete" };
		fake.state.args = verdict;
		const schema = z.object({ score: z.number(), reason: z.string() });
		const result = await (await build()).withStructuredOutput(schema).invoke("judge this");
		expect(result).toEqual(verdict);
	});

	it("runs a createAgent tool loop to completion", async () => {
		fake.state.args = SEND_ARGS;
		const sent: string[] = [];
		const sendMessage = tool(
			async ({ text }) => {
				sent.push(text);
				return "sent";
			},
			{ name: "send_message", description: "Send a chat message", schema: sendMessageSchema },
		);
		fake.state.requests.length = 0;
		const agent = createAgent({ model: await build(), tools: [sendMessage] });
		const output = await agent.invoke({ messages: [new HumanMessage("Begin the conversation.")] });
		expect(sent).toEqual([SEND_ARGS.text]);
		expect(output.messages.at(-1)?.text).toBe("done");
	});
});
