import { describe, expect, it } from "vitest";
import { FakeBrowserSession } from "../../testing/fake-browser-session.js";
import { InMemoryStepRecorder } from "./recorder.js";
import { createConversationState } from "./state.js";
import { createSimulatorTools, MAX_TOOL_RESULT_CHARS } from "./tools.js";

type Invokable = { invoke(input: Record<string, unknown>): Promise<unknown> };

function byName(tools: ReturnType<typeof createSimulatorTools>, name: string): Invokable {
	const found = tools.find((t) => t.name === name);
	if (!found) throw new Error(`tool ${name} not bound`);
	return found as unknown as Invokable;
}

describe("createSimulatorTools", () => {
	it("binds the ActionSchema kinds; vision tools only on demand", () => {
		const session = new FakeBrowserSession();
		const recorder = new InMemoryStepRecorder();
		const names = createSimulatorTools({ session, recorder, vision: false }).map((t) => t.name);
		expect(names).toEqual([
			"snapshot",
			"click",
			"type",
			"press",
			"scroll",
			"wait",
			"send_message",
			"read_conversation",
			"download",
			"upload",
			"end_conversation",
		]);
		const visionNames = createSimulatorTools({ session, recorder, vision: true }).map(
			(t) => t.name,
		);
		expect(visionNames.slice(-3)).toEqual(["screenshot_view", "click_at", "type_at"]);
	});

	it("truncates long tool results to 4 kB and records the truncated text on the step", async () => {
		const longTree = Array.from(
			{ length: 400 },
			(_, i) => `- paragraph: line ${i} ${"x".repeat(20)}`,
		)
			.concat('- textbox "Message" [ref=e1]')
			.join("\n");
		const session = new FakeBrowserSession({ snapshots: [longTree] });
		const recorder = new InMemoryStepRecorder();
		const tools = createSimulatorTools({ session, recorder, vision: false });
		const result = (await byName(tools, "read_conversation").invoke({})) as string;
		expect(result.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 64);
		expect(result).toMatch(/truncated \d+ characters/);
		expect(recorder.steps[0]?.result).toBe(result);
		expect(recorder.steps[0]?.snapshot).toBeDefined();
	});

	it("refuses send_message once the turn budget is used up", async () => {
		const session = new FakeBrowserSession({ replies: ["a", "b"] });
		const recorder = new InMemoryStepRecorder();
		const state = createConversationState(1);
		const tools = createSimulatorTools({ session, recorder, vision: false, state });
		const send = byName(tools, "send_message");
		expect(await send.invoke({ text: "first" })).toBe("a");
		expect(state.turnsUsed).toBe(1);
		expect(await send.invoke({ text: "second" })).toMatch(/^error: Turn budget exhausted/);
		expect(state.turnsUsed).toBe(1);
		expect(session.calls.filter((c) => c.method === "type")).toHaveLength(1);
	});

	it("assigns steps to the turn being prepared and end_conversation to the finished turn", async () => {
		const session = new FakeBrowserSession({ replies: ["a"] });
		const recorder = new InMemoryStepRecorder();
		const state = createConversationState(3);
		const tools = createSimulatorTools({ session, recorder, vision: false, state });
		await byName(tools, "snapshot").invoke({});
		await byName(tools, "send_message").invoke({ text: "hi" });
		await byName(tools, "snapshot").invoke({});
		await byName(tools, "end_conversation").invoke({ reason: "gave_up", summary: "meh" });
		expect(recorder.steps.map((s) => `${s.action.kind}@${s.turn}`)).toEqual([
			"snapshot@1",
			"send_message@1",
			"snapshot@2",
			"end_conversation@1",
		]);
		expect(state.ended).toEqual({ reason: "gave_up", summary: "meh" });
	});
});
