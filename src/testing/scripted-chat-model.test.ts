import { createAgent, HumanMessage, tool } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ScriptedChatModel } from "./scripted-chat-model.js";

const echo = tool(async ({ text }: { text: string }) => `echo:${text}`, {
	name: "echo",
	description: "Echoes text",
	schema: z.object({ text: z.string() }),
});

describe("ScriptedChatModel with createAgent (P0 smoke)", () => {
	it("completes a tool round-trip: scripted tool call → tool result → final answer", async () => {
		const model = new ScriptedChatModel({
			script: [{ toolCalls: [{ name: "echo", args: { text: "hi" } }] }, "done"],
		});
		const agent = createAgent({ model, tools: [echo], systemPrompt: "You are a test." });
		const result = await agent.invoke({ messages: [new HumanMessage("go")] });
		const last = result.messages.at(-1);
		expect(last?.content).toBe("done");
		const toolMessage = result.messages.find((m) => m.getType() === "tool");
		expect(toolMessage?.content).toBe("echo:hi");
		expect(model.callCount).toBe(2);
		// The second prompt contains the tool result, proving the loop fed it back.
		expect(model.calls[1]?.some((m) => m.getType() === "tool")).toBe(true);
		expect(model.boundTools.length).toBeGreaterThan(0);
	});

	it("produces structuredResponse via responseFormat using a scripted tool call", async () => {
		const Verdict = z.object({ score: z.number(), pass: z.boolean(), reason: z.string() });
		const model = new ScriptedChatModel({
			script: [
				(messages, call) => {
					// The agent binds a structured-output tool; find its name from the bound tools.
					const names = model.boundToolNames();
					const outputTool = names.find((n) => n !== "echo");
					if (!outputTool) throw new Error(`no structured tool bound at call ${call}: ${names}`);
					void messages;
					return {
						toolCalls: [{ name: outputTool, args: { score: 0.8, pass: true, reason: "ok" } }],
					};
				},
			],
		});
		const agent = createAgent({ model, tools: [echo], responseFormat: Verdict });
		const result = await agent.invoke({ messages: [new HumanMessage("judge")] });
		expect(result.structuredResponse).toEqual({ score: 0.8, pass: true, reason: "ok" });
	});

	it("records multimodal content blocks it receives", async () => {
		const model = new ScriptedChatModel({ script: ["seen"] });
		await model.invoke([
			new HumanMessage({
				content: [
					{ type: "text", text: "what is on screen?" },
					{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				],
			}),
		]);
		const first = model.calls[0]?.[0];
		const content = first?.content;
		if (!Array.isArray(content)) throw new Error("expected array content");
		expect(content[1]).toMatchObject({ type: "image" });
	});

	it("throws when strict and the script is exhausted", async () => {
		const model = new ScriptedChatModel({ script: ["a"], strict: true });
		await model.invoke("1");
		await expect(model.invoke("2")).rejects.toThrow(/exhausted/);
	});
});
