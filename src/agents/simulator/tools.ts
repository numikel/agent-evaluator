import { tool } from "langchain";
import { z } from "zod";
import type { BrowserSession, DownloadResult } from "../../browser/types.js";
import type { Action, TranscriptEntry } from "../../schemas/index.js";
import type { StepRecorder } from "./recorder.js";
import { type ConversationState, createConversationState } from "./state.js";
import { extractBotReply, findMessageTextbox, treeToText } from "./tree.js";

/** Tool results are truncated to this many characters before reaching the model. */
export const MAX_TOOL_RESULT_CHARS = 4096;

export type SimulatorTimeouts = {
	response_ms: number;
	stable_ms: number;
	capture_interval_ms: number;
};

export type SimulatorToolsOptions = {
	session: BrowserSession;
	recorder: StepRecorder;
	/** Bind `screenshot_view`, `click_at` and `type_at`. */
	vision: boolean;
	/** Shared run state; created with `max_turns = 1` when omitted (handy for ad-hoc tool tests). */
	state?: ConversationState;
	timeouts?: Partial<SimulatorTimeouts>;
	onMessage?: (entry: TranscriptEntry) => void | Promise<void>;
	onDownload?: (download: DownloadResult, stepId: number) => void | Promise<void>;
};

const DEFAULT_TIMEOUTS: SimulatorTimeouts = {
	response_ms: 60_000,
	stable_ms: 1500,
	capture_interval_ms: 2000,
};

export function truncateResult(text: string, max = MAX_TOOL_RESULT_CHARS): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n…[truncated ${text.length - max} characters]`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Builds the simulator tool set. Every tool call becomes one `Step` on the recorder. */
export function createSimulatorTools(options: SimulatorToolsOptions) {
	const { session, recorder, vision } = options;
	const state = options.state ?? createConversationState(1);
	const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };

	const currentTurn = (): number => Math.min(state.turnsUsed + 1, state.maxTurns);

	/** Runs `body` as a recorded step: before/after screenshots, result or error, truncation. */
	async function step(
		action: Action,
		body: (stepId: number) => Promise<string>,
		turn = currentTurn(),
	): Promise<string> {
		const stepId = await recorder.begin(action, { turn });
		let outcome: { result: string } | { error: string };
		try {
			const before = await session.screenshot();
			await recorder.attachBefore(stepId, before.png);
			outcome = { result: truncateResult(await body(stepId)) };
		} catch (error) {
			outcome = { error: truncateResult(errorMessage(error)) };
		}
		try {
			const after = await session.screenshot();
			await recorder.attachAfter(stepId, after.png);
		} catch {
			// the "after" screenshot is evidence, never a reason to fail the step
		}
		await recorder.end(stepId, outcome);
		return "error" in outcome ? `error: ${outcome.error}` : outcome.result;
	}

	async function takeSnapshot(stepId: number): Promise<string> {
		const snap = await session.snapshot();
		state.latestTree = snap.tree;
		await recorder.attachSnapshot(stepId, snap.tree);
		return snap.tree;
	}

	async function emit(entry: TranscriptEntry): Promise<void> {
		state.transcript.push(entry);
		await options.onMessage?.(entry);
	}

	const snapshot = tool(
		async () =>
			step({ kind: "snapshot" }, async (stepId) => {
				const snap = await session.snapshot();
				state.latestTree = snap.tree;
				await recorder.attachSnapshot(stepId, snap.tree);
				return `URL: ${snap.url}\nTitle: ${snap.title}\n\n${snap.tree}`;
			}),
		{
			name: "snapshot",
			description:
				"Returns the current page as an accessibility tree. Elements carry [ref=eN] markers that other tools accept.",
			schema: z.object({}),
		},
	);

	const click = tool(
		async ({ ref }: { ref: string }) =>
			step({ kind: "click", ref }, async () => {
				await session.click(ref);
				return `Clicked ${ref}.`;
			}),
		{
			name: "click",
			description: "Clicks the element with the given ref (e.g. e12) from the latest snapshot.",
			schema: z.object({ ref: z.string().describe("Element ref such as e12") }),
		},
	);

	const typeTool = tool(
		async ({ ref, text, submit }: { ref: string; text: string; submit?: boolean }) =>
			step({ kind: "type", ref, text, submit: submit ?? false }, async () => {
				await session.type(ref, text, { submit: submit ?? false });
				return `Typed into ${ref}${submit ? " and pressed Enter" : ""}.`;
			}),
		{
			name: "type",
			description:
				"Types text into the element with the given ref. Set submit=true to press Enter afterwards. Prefer send_message for chat messages.",
			schema: z.object({
				ref: z.string(),
				text: z.string(),
				submit: z.boolean().optional().describe("Press Enter after typing"),
			}),
		},
	);

	const press = tool(
		async ({ key }: { key: string }) =>
			step({ kind: "press", key }, async () => {
				await session.press(key);
				return `Pressed ${key}.`;
			}),
		{
			name: "press",
			description: "Presses a keyboard key, e.g. Enter, Escape, Tab, ArrowDown.",
			schema: z.object({ key: z.string() }),
		},
	);

	const scroll = tool(
		async ({ direction, amount }: { direction: "up" | "down"; amount?: number }) =>
			step({ kind: "scroll", direction, amount: amount ?? 500 }, async () => {
				await session.scroll(direction, amount ?? 500);
				return `Scrolled ${direction}.`;
			}),
		{
			name: "scroll",
			description: "Scrolls the page up or down by an amount in pixels (default 500).",
			schema: z.object({ direction: z.enum(["up", "down"]), amount: z.number().optional() }),
		},
	);

	const wait = tool(
		async ({ ms }: { ms: number }) =>
			step({ kind: "wait", ms }, async () => {
				await session.wait(ms);
				return `Waited ${ms} ms.`;
			}),
		{
			name: "wait",
			description: "Waits for the given number of milliseconds (max 30000).",
			schema: z.object({ ms: z.number().int().positive().max(30_000) }),
		},
	);

	const sendMessage = tool(
		async ({ text }: { text: string }) =>
			step({ kind: "send_message", text }, async (stepId) => {
				if (state.ended) throw new Error("The conversation has already ended.");
				if (state.turnsUsed >= state.maxTurns) {
					throw new Error(
						`Turn budget exhausted (${state.maxTurns} turns). Call end_conversation now.`,
					);
				}
				const before = state.latestTree ?? (await takeSnapshot(stepId));
				const ref = findMessageTextbox(before);
				if (!ref) {
					throw new Error(
						"No message textbox found in the latest snapshot. Call snapshot, then open the chat or use click/type with a ref.",
					);
				}
				await session.type(ref, text, { submit: true });
				const turn = ++state.turnsUsed;
				await emit({ turn, role: "user", text, at: new Date().toISOString(), step: stepId });

				const result = await session.waitForReplyStable({
					timeoutMs: timeouts.response_ms,
					stableMs: timeouts.stable_ms,
					captureIntervalMs: timeouts.capture_interval_ms,
					onInterim: (shot) => recorder.attachInterim(stepId, shot.png),
				});
				const after = result.snapshot.tree;
				state.latestTree = after;
				await recorder.attachSnapshot(stepId, after);
				const reply = extractBotReply({ before, after, userText: text });
				if (reply.length > 0) {
					await emit({
						turn,
						role: "bot",
						text: reply,
						at: new Date().toISOString(),
						latency_ms: result.firstChangeMs ?? result.elapsedMs,
						step: stepId,
					});
				}
				if (reply.length === 0) {
					return `(no reply detected after ${result.elapsedMs} ms${result.stable ? "" : "; page still changing"}. Call read_conversation or snapshot to inspect the page.)`;
				}
				return result.stable
					? reply
					: `${reply}\n(reply may still be streaming after ${result.elapsedMs} ms)`;
			}),
		{
			name: "send_message",
			description:
				"Sends one chat message as the user: types it into the chat input, submits, waits for the bot to finish answering and returns the bot's reply text. Counts as one turn.",
			schema: z.object({ text: z.string().min(1) }),
		},
	);

	const readConversation = tool(
		async () =>
			step({ kind: "read_conversation" }, async (stepId) => {
				const tree = await takeSnapshot(stepId);
				return treeToText(tree) || "(the page has no readable text)";
			}),
		{
			name: "read_conversation",
			description: "Returns the readable text of the current page (the chat so far).",
			schema: z.object({}),
		},
	);

	const download = tool(
		async ({ ref }: { ref: string }) =>
			step({ kind: "download", ref }, async (stepId) => {
				const file = await session.download(ref, timeouts.response_ms);
				await options.onDownload?.(file, stepId);
				return `Downloaded "${file.filename}" (${file.bytes} bytes, ${file.mime ?? "unknown type"}) saved to ${file.path}.`;
			}),
		{
			name: "download",
			description:
				"Clicks the link or button with the given ref and captures the file it downloads.",
			schema: z.object({ ref: z.string() }),
		},
	);

	const upload = tool(
		async ({ ref, file }: { ref: string; file: string }) =>
			step({ kind: "upload", ref, file }, async () => {
				await session.upload(ref, [file]);
				return `Uploaded ${file} via ${ref}.`;
			}),
		{
			name: "upload",
			description: "Clicks the file input or button with the given ref and attaches the file.",
			schema: z.object({ ref: z.string(), file: z.string().describe("Absolute file path") }),
		},
	);

	const endConversation = tool(
		async ({
			reason,
			summary,
		}: {
			reason: "goal_reached" | "gave_up" | "blocked";
			summary: string;
		}) =>
			step(
				{ kind: "end_conversation", reason, summary },
				async () => {
					state.ended = { reason, summary };
					return `Conversation ended (${reason}).`;
				},
				state.turnsUsed,
			),
		{
			name: "end_conversation",
			description:
				"Ends the conversation. Use goal_reached when the success criteria are met, gave_up when this person would stop trying, blocked when the interface prevents progress.",
			schema: z.object({
				reason: z.enum(["goal_reached", "gave_up", "blocked"]),
				summary: z.string().describe("One or two sentences on what happened"),
			}),
		},
	);

	const screenshotView = tool(
		async () =>
			step({ kind: "screenshot_view" }, async () => {
				const shot = await session.screenshot();
				state.pendingScreenshot = shot;
				return `Screenshot captured (${shot.width}x${shot.height}); it is attached to your next message.`;
			}),
		{
			name: "screenshot_view",
			description: "Captures a screenshot of the page and shows it to you with the next message.",
			schema: z.object({}),
		},
	);

	const clickAt = tool(
		async ({ x, y }: { x: number; y: number }) =>
			step({ kind: "click_at", x, y }, async () => {
				await session.clickAt(x, y);
				return `Clicked at (${x}, ${y}).`;
			}),
		{
			name: "click_at",
			description: "Clicks at viewport pixel coordinates taken from the latest screenshot.",
			schema: z.object({ x: z.number(), y: z.number() }),
		},
	);

	const typeAt = tool(
		async ({ x, y, text, submit }: { x: number; y: number; text: string; submit?: boolean }) =>
			step({ kind: "type_at", x, y, text }, async () => {
				await session.typeAt(x, y, text, { submit: submit ?? false });
				return `Typed at (${x}, ${y})${submit ? " and pressed Enter" : ""}.`;
			}),
		{
			name: "type_at",
			description:
				"Clicks at viewport pixel coordinates and types text; submit=true presses Enter.",
			schema: z.object({
				x: z.number(),
				y: z.number(),
				text: z.string(),
				submit: z.boolean().optional(),
			}),
		},
	);

	const base = [
		snapshot,
		click,
		typeTool,
		press,
		scroll,
		wait,
		sendMessage,
		readConversation,
		download,
		upload,
		endConversation,
	];
	return vision ? [...base, screenshotView, clickAt, typeAt] : base;
}

export type SimulatorTools = ReturnType<typeof createSimulatorTools>;
