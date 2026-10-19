import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../../schemas/index.js";
import { FakeBrowserSession } from "../../testing/fake-browser-session.js";
import { ScriptedChatModel, type ScriptedTurn } from "../../testing/scripted-chat-model.js";
import { makeFixture } from "./fixtures.test-helper.js";
import { InMemoryStepRecorder } from "./recorder.js";
import { runSimulator } from "./run.js";

const sendMessage = (text: string): ScriptedTurn => ({
	toolCalls: [{ name: "send_message", args: { text } }],
});
const endConversation = (
	reason: "goal_reached" | "gave_up" | "blocked",
	summary = "done",
): ScriptedTurn => ({
	toolCalls: [{ name: "end_conversation", args: { reason, summary } }],
});

function lastToolMessage(messages: BaseMessage[] | undefined): string {
	const tool = messages?.filter((m) => m.getType() === "tool").at(-1);
	return typeof tool?.content === "string" ? tool.content : JSON.stringify(tool?.content);
}

function systemText(messages: BaseMessage[] | undefined): string {
	return messages?.find((m) => m.getType() === "system")?.text ?? "";
}

describe("runSimulator", () => {
	it("seam 2: send_message types + submits, waits for the reply and records transcript + step", async () => {
		const fixture = makeFixture({ maxTurns: 6 });
		const session = new FakeBrowserSession({ replies: ["Sure, here is your invoice."] });
		const model = new ScriptedChatModel({
			script: [sendMessage("need my invoice"), endConversation("goal_reached", "got it")],
			strict: true,
		});
		const recorder = new InMemoryStepRecorder();
		const messages: TranscriptEntry[] = [];

		const result = await runSimulator({
			resolved: fixture,
			session,
			model,
			recorder,
			onMessage: (entry) => {
				messages.push(entry);
			},
		});

		expect(session.calls).toContainEqual({
			method: "type",
			args: ["e1", "need my invoice", { submit: true }],
		});
		const wait = session.calls.find((c) => c.method === "waitForReplyStable");
		expect(wait?.args[0]).toMatchObject({ timeoutMs: 5000, stableMs: 100, captureIntervalMs: 50 });
		expect(lastToolMessage(model.calls[1])).toBe("Sure, here is your invoice.");

		expect(result.transcript).toHaveLength(2);
		expect(result.transcript[0]).toMatchObject({ turn: 1, role: "user", text: "need my invoice" });
		expect(result.transcript[1]).toMatchObject({
			turn: 1,
			role: "bot",
			text: "Sure, here is your invoice.",
			latency_ms: 10,
		});
		expect(messages).toEqual(result.transcript);

		const step = recorder.steps.find((s) => s.action.kind === "send_message");
		expect(step).toBeDefined();
		expect(step?.action).toEqual({ kind: "send_message", text: "need my invoice" });
		expect(step?.turn).toBe(1);
		expect(step?.screenshot_before).toBeDefined();
		expect(step?.screenshot).toBeDefined();
		expect(step?.snapshot).toBeDefined();
		expect(step?.interim_screenshots).toHaveLength(1);
		expect(step?.result).toBe("Sure, here is your invoice.");
		expect(result.transcript[0]?.step).toBe(step?.index);
		expect(systemText(model.calls[0])).toContain("Turn 1 of 6");
	});

	it("seam 3: end_conversation(goal_reached) stops the loop without another model call", async () => {
		const session = new FakeBrowserSession({ replies: ["Here you go."] });
		const model = new ScriptedChatModel({
			script: [sendMessage("invoice please"), endConversation("goal_reached", "Got the PDF.")],
			strict: true,
		});
		const result = await runSimulator({
			resolved: makeFixture(),
			session,
			model,
			recorder: new InMemoryStepRecorder(),
		});
		expect(result).toMatchObject({ reason: "goal_reached", summary: "Got the PDF.", turnsUsed: 1 });
		expect(model.callCount).toBe(2);
	});

	it("seam 4: stops at max_turns and executes no further send_message", async () => {
		const session = new FakeBrowserSession({ replies: ["one", "two", "three"] });
		const model = new ScriptedChatModel({ script: [sendMessage("again")] });
		const recorder = new InMemoryStepRecorder();
		const result = await runSimulator({
			resolved: makeFixture({ maxTurns: 2 }),
			session,
			model,
			recorder,
		});
		expect(result.reason).toBe("max_turns");
		expect(result.turnsUsed).toBe(2);
		expect(session.calls.filter((c) => c.method === "type")).toHaveLength(2);
		expect(result.transcript.map((e) => `${e.turn}:${e.role}`)).toEqual([
			"1:user",
			"1:bot",
			"2:user",
			"2:bot",
		]);
		expect(recorder.steps.filter((s) => s.action.kind === "send_message")).toHaveLength(2);
		// turn 1, turn 2, then the third model call wanted to keep going and was cut off
		expect(model.callCount).toBe(3);
		expect(systemText(model.calls[1])).toContain("Turn 2 of 2");
	});

	it("seam 5: download records a step and returns the file; unscripted download becomes an error result", async () => {
		const session = new FakeBrowserSession({
			replies: ["Your invoice is ready."],
			downloads: [
				{
					filename: "invoice-09.pdf",
					path: "/tmp/dl/invoice-09.pdf",
					mime: "application/pdf",
					bytes: 1234,
				},
			],
		});
		const model = new ScriptedChatModel({
			script: [
				sendMessage("invoice"),
				{ toolCalls: [{ name: "download", args: { ref: "e5" } }] },
				{ toolCalls: [{ name: "download", args: { ref: "e6" } }] },
				endConversation("gave_up", "second download failed"),
			],
			strict: true,
		});
		const recorder = new InMemoryStepRecorder();
		const downloads: string[] = [];
		const result = await runSimulator({
			resolved: makeFixture(),
			session,
			model,
			recorder,
			onDownload: (d) => {
				downloads.push(d.filename);
			},
		});
		const first = lastToolMessage(model.calls[2]);
		expect(first).toContain("invoice-09.pdf");
		expect(first).toContain("1234");
		expect(first).toContain("application/pdf");
		expect(lastToolMessage(model.calls[3])).toMatch(/^error: .*no scripted download/);
		expect(result.reason).toBe("gave_up");
		expect(downloads).toEqual(["invoice-09.pdf"]);
		const steps = recorder.steps.filter((s) => s.action.kind === "download");
		expect(steps).toHaveLength(2);
		expect(steps[0]?.result).toContain("invoice-09.pdf");
		expect(steps[1]?.error).toMatch(/no scripted download/);
	});

	it("seam 6: vision tools are bound only when vision is enabled", async () => {
		const model = new ScriptedChatModel({ script: [endConversation("gave_up")], strict: true });
		await runSimulator({
			resolved: makeFixture({ vision: false }),
			session: new FakeBrowserSession(),
			model,
			recorder: new InMemoryStepRecorder(),
		});
		const names = model.boundToolNames();
		expect(names).toContain("send_message");
		expect(names).toContain("snapshot");
		expect(names).not.toContain("click_at");
		expect(names).not.toContain("type_at");
		expect(names).not.toContain("screenshot_view");
	});

	it("seam 6: in vision mode screenshot_view injects an image block into the next model call", async () => {
		const model = new ScriptedChatModel({
			script: [
				{ toolCalls: [{ name: "screenshot_view", args: {} }] },
				{ toolCalls: [{ name: "click_at", args: { x: 10, y: 20 } }] },
				endConversation("gave_up"),
			],
			strict: true,
		});
		const session = new FakeBrowserSession();
		await runSimulator({
			resolved: makeFixture({ vision: true }),
			session,
			model,
			recorder: new InMemoryStepRecorder(),
		});
		expect(model.boundToolNames()).toEqual(
			expect.arrayContaining(["screenshot_view", "click_at", "type_at"]),
		);
		const second = model.calls[1];
		const last = second?.at(-1);
		expect(last?.getType()).toBe("human");
		const content = last?.content;
		if (!Array.isArray(content)) throw new Error("expected multimodal content");
		expect(content).toContainEqual(
			expect.objectContaining({ type: "image", mimeType: "image/png", data: expect.any(String) }),
		);
		// never inside a ToolMessage
		for (const call of model.calls) {
			for (const m of call) {
				if (m.getType() === "tool") expect(typeof m.content).toBe("string");
			}
		}
		// the image is not re-sent once consumed
		const third = model.calls[2];
		expect(third?.at(-1)?.getType()).toBe("tool");
		expect(session.calls).toContainEqual({ method: "clickAt", args: [10, 20] });
	});

	it("seam 7: an unknown ref error is returned to the model as text and the loop continues", async () => {
		class StrictFakeSession extends FakeBrowserSession {
			override async click(ref: string): Promise<void> {
				if (ref !== "e2") throw new Error(`Unknown ref ${ref}`);
				return super.click(ref);
			}
		}
		const session = new StrictFakeSession({ replies: ["ok"] });
		const model = new ScriptedChatModel({
			script: [
				{ toolCalls: [{ name: "click", args: { ref: "e99" } }] },
				sendMessage("hello"),
				endConversation("goal_reached"),
			],
			strict: true,
		});
		const recorder = new InMemoryStepRecorder();
		const result = await runSimulator({
			resolved: makeFixture(),
			session,
			model,
			recorder,
		});
		expect(lastToolMessage(model.calls[1])).toBe("error: Unknown ref e99");
		expect(result).toMatchObject({ reason: "goal_reached", turnsUsed: 1 });
		const failed = recorder.steps.find((s) => s.action.kind === "click");
		expect(failed?.error).toBe("Unknown ref e99");
		expect(failed?.screenshot_before).toBeDefined();
		expect(failed?.screenshot).toBeDefined();
	});

	it("returns an error result when send_message cannot find a textbox, and the loop continues", async () => {
		const session = new FakeBrowserSession({ snapshots: ['- button "Open chat" [ref=e1]'] });
		const model = new ScriptedChatModel({
			script: [sendMessage("hello"), endConversation("blocked", "no input")],
			strict: true,
		});
		const result = await runSimulator({
			resolved: makeFixture(),
			session,
			model,
			recorder: new InMemoryStepRecorder(),
		});
		expect(lastToolMessage(model.calls[1])).toMatch(/^error: .*textbox/i);
		expect(session.calls.some((c) => c.method === "type")).toBe(false);
		expect(result).toMatchObject({ reason: "blocked", turnsUsed: 0 });
	});

	it("maps a model failure to reason 'error' and keeps the partial transcript", async () => {
		const session = new FakeBrowserSession({ replies: ["hi"] });
		const model = new ScriptedChatModel({ script: [sendMessage("hello")], strict: true });
		const result = await runSimulator({
			resolved: makeFixture(),
			session,
			model,
			recorder: new InMemoryStepRecorder(),
		});
		expect(result.reason).toBe("error");
		expect(result.summary).toMatch(/exhausted/);
		expect(result.turnsUsed).toBe(1);
		expect(result.transcript).toHaveLength(2);
	});

	it("maps an exhausted tool-call budget to reason 'blocked'", async () => {
		const model = new ScriptedChatModel({
			script: [{ toolCalls: [{ name: "snapshot", args: {} }] }],
		});
		const session = new FakeBrowserSession();
		const result = await runSimulator({
			resolved: makeFixture({ maxTurns: 1 }),
			session,
			model,
			recorder: new InMemoryStepRecorder(),
		});
		expect(result.reason).toBe("blocked");
		expect(result.summary).toMatch(/tool-call budget/i);
		expect(session.calls.filter((c) => c.method === "snapshot").length).toBeLessThanOrEqual(8);
	});

	it("ends with 'gave_up' when the model stops calling tools without end_conversation", async () => {
		const model = new ScriptedChatModel({ script: ["I give up."], strict: true });
		const result = await runSimulator({
			resolved: makeFixture(),
			session: new FakeBrowserSession(),
			model,
			recorder: new InMemoryStepRecorder(),
		});
		expect(result).toMatchObject({ reason: "gave_up", summary: "I give up.", turnsUsed: 0 });
	});
});
