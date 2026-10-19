import type { RunEvent, RunRecord, Step } from "@schemas/run";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "../app/routes.js";
import * as fx from "../mocks/fixtures.js";
import { server } from "../mocks/server.js";

type Listener = (event: MessageEvent<string>) => void;

/** jsdom ships no EventSource; this stand-in lets tests push `data:` payloads by hand. */
class FakeEventSource {
	static instances: FakeEventSource[] = [];
	readonly url: string;
	onmessage: Listener | null = null;
	onerror: ((event: Event) => void) | null = null;
	onopen: (() => void) | null = null;
	closed = false;
	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}
	open() {
		this.onopen?.();
	}
	emit(event: RunEvent) {
		this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
	}
	fail() {
		this.onerror?.(new Event("error"));
	}
	close() {
		this.closed = true;
	}
}

const RUN_ID = fx.RUNNING_RUN_ID;
const run = fx.runs.find((r) => r.id === RUN_ID) as RunRecord;
const at = (s: number) => new Date(Date.parse(run.started_at) + s * 1000).toISOString();
/** The "Turn" fact is a <dt>/<dd> pair, so there is no whitespace between label and value. */
const turn = (k: number, n: number) => new RegExp(`Turn\\s*${k}/${n}`);

function stepEvent(index: number, extra: Partial<Step> = {}) {
	const event: RunEvent = {
		type: "step",
		runId: RUN_ID,
		at: at(index),
		step: {
			index,
			turn: 1,
			action: { kind: "open", url: "http://demo.local/" },
			interim_screenshots: [],
			screenshot: `steps/${String(index).padStart(3, "0")}/after.png`,
			...extra,
		},
	};
	return event;
}

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(<RouterProvider router={router} />);
	return router;
}

/** Renders the running fixture and waits for its stream to be opened. */
async function renderLive() {
	renderAt(`/runs/${RUN_ID}`);
	await screen.findByTestId("page-run-detail");
	await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
	const source = FakeEventSource.instances[0] as FakeEventSource;
	await act(async () => source.open());
	return source;
}

const emitAll = (source: FakeEventSource, events: RunEvent[]) =>
	act(async () => {
		for (const event of events) source.emit(event);
	});

const stepsList = () => screen.getByRole("list", { name: /steps/i });

describe("RunDetailPage (live)", () => {
	beforeEach(() => {
		FakeEventSource.instances = [];
		vi.stubGlobal("EventSource", FakeEventSource);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("opens the run's stream and shows the header from the stored record", async () => {
		const source = await renderLive();
		expect(source.url).toBe(`/api/runs/${RUN_ID}/events`);
		const header = screen.getByRole("region", { name: /run overview/i });
		expect(within(header).getByRole("status", { name: /run status/i })).toHaveTextContent(
			"RUNNING",
		);
		expect(header).toHaveTextContent(turn(run.turns_used, run.max_turns));
		expect(header).toHaveTextContent(/elapsed/i);
		expect(screen.getByRole("button", { name: /cancel run/i })).toBeInTheDocument();
	});

	it("fills thumbnails, transcript, downloads and criteria from events, then the verdict", async () => {
		const source = await renderLive();
		await emitAll(source, [
			{ type: "run_started", runId: RUN_ID, at: at(0), run },
			{ type: "status", runId: RUN_ID, at: at(1), status: "RUNNING" },
			stepEvent(1),
			stepEvent(2, { action: { kind: "send_message", text: "need my invoice" } }),
			{ type: "turn", runId: RUN_ID, at: at(3), turn: 1, max_turns: run.max_turns },
			{
				type: "message",
				runId: RUN_ID,
				at: at(4),
				entry: { turn: 1, role: "user", text: "need my invoice", at: at(4) },
			},
			{
				type: "message",
				runId: RUN_ID,
				at: at(9),
				entry: { turn: 1, role: "bot", text: "Here it is.", at: at(9), latency_ms: 4200 },
			},
			{
				type: "download",
				runId: RUN_ID,
				at: at(10),
				artifact: { path: "downloads/invoice.pdf", filename: "invoice.pdf", bytes: 1111, step: 2 },
			},
		]);
		const thumbs = within(stepsList()).getAllByRole("listitem");
		expect(thumbs).toHaveLength(2);
		expect(within(thumbs[0] as HTMLElement).getByRole("img")).toHaveAttribute(
			"src",
			`/api/runs/${RUN_ID}/artifacts/steps/001/after.png`,
		);
		expect(screen.getByRole("region", { name: /run overview/i })).toHaveTextContent(
			turn(1, run.max_turns),
		);
		const transcript = screen.getByRole("region", { name: /transcript/i });
		expect(transcript).toHaveTextContent("need my invoice");
		expect(transcript).toHaveTextContent("Here it is.");
		expect(transcript).toHaveTextContent("4.2 s");
		const downloads = screen.getByRole("region", { name: /downloads/i });
		expect(within(downloads).getByRole("link", { name: /invoice\.pdf/ })).toHaveAttribute(
			"href",
			`/api/runs/${RUN_ID}/artifacts/downloads/invoice.pdf`,
		);
		expect(downloads).toHaveTextContent("1.1 kB");

		const [first, second] = fx.verdict.criteria;
		if (!first || !second) throw new Error("fixture needs two criteria");
		await emitAll(source, [
			{ type: "status", runId: RUN_ID, at: at(11), status: "JUDGING" },
			{ type: "judge_started", runId: RUN_ID, at: at(12), criteria: [first.id, second.id] },
			{ type: "criterion", runId: RUN_ID, at: at(13), result: { ...second, score: 0.6 } },
		]);
		expect(screen.getByRole("status", { name: /run status/i })).toHaveTextContent("JUDGING");
		const criteria = screen.getByRole("region", { name: /criteria/i });
		const pendingRow = within(criteria).getByRole("row", { name: new RegExp(first.id) });
		expect(pendingRow).toHaveTextContent(/pending/i);
		const scoredRow = within(criteria).getByRole("row", { name: new RegExp(second.id) });
		expect(scoredRow).toHaveTextContent("60%");
		expect(scoredRow).toHaveTextContent(/pass/i);
		expect(scoredRow).toHaveTextContent(second.reason);

		const verdict = { ...fx.verdict, runId: RUN_ID };
		await emitAll(source, [
			{ type: "criterion", runId: RUN_ID, at: at(14), result: first },
			{ type: "status", runId: RUN_ID, at: at(15), status: "PASSED" },
			{ type: "done", runId: RUN_ID, at: at(16), verdict, report: "report.html" },
		]);
		expect(screen.getByRole("status", { name: /run status/i })).toHaveTextContent("PASSED");
		const verdictPanel = screen.getByRole("region", { name: /verdict/i });
		expect(within(verdictPanel).getByRole("meter")).toHaveAttribute(
			"aria-valuenow",
			String(Math.round(verdict.score * 100)),
		);
		expect(verdictPanel).toHaveTextContent(verdict.summary);
		expect(screen.getByTitle(/report/i)).toHaveAttribute("src", `/api/runs/${RUN_ID}/report`);
		expect(screen.getByRole("link", { name: /open report in a new tab/i })).toHaveAttribute(
			"href",
			`/api/runs/${RUN_ID}/report`,
		);
		expect(screen.queryByRole("button", { name: /cancel run/i })).not.toBeInTheDocument();
		expect(source.closed).toBe(true);
	});

	it("absorbs a burst of 100 step events without dropping any", async () => {
		const source = await renderLive();
		await emitAll(
			source,
			Array.from({ length: 100 }, (_, i) => stepEvent(i + 1)),
		);
		await waitFor(() => expect(within(stepsList()).getAllByRole("listitem")).toHaveLength(100));
	});

	it("opens a step panel with the full screenshot, the action and the snapshot text", async () => {
		server.use(
			http.get("*/api/runs/:id/artifacts/steps/001/snapshot.txt", () =>
				HttpResponse.text('- log "Conversation"\n  - article "Hi"'),
			),
		);
		const source = await renderLive();
		await emitAll(source, [
			stepEvent(1, { snapshot: "steps/001/snapshot.txt", thought: "Look around first." }),
		]);
		fireEvent.click(within(stepsList()).getByRole("button", { name: /step 1/i }));
		const panel = await screen.findByRole("region", { name: /step 1 details/i });
		expect(within(panel).getByRole("img")).toHaveAttribute(
			"src",
			`/api/runs/${RUN_ID}/artifacts/steps/001/after.png`,
		);
		expect(panel).toHaveTextContent('"kind": "open"');
		expect(panel).toHaveTextContent("Look around first.");
		expect(await within(panel).findByText(/log "Conversation"/)).toBeInTheDocument();
		fireEvent.click(within(panel).getByRole("button", { name: /close/i }));
		expect(screen.queryByRole("region", { name: /step 1 details/i })).not.toBeInTheDocument();
	});

	it("shows a reconnecting indicator on stream errors and resets on reopen", async () => {
		const source = await renderLive();
		await emitAll(source, [stepEvent(1)]);
		await act(async () => source.fail());
		expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
		await act(async () => source.open());
		expect(screen.queryByText(/reconnecting/i)).not.toBeInTheDocument();
		// The server replays the history on reconnect: the same step must not be duplicated.
		await emitAll(source, [stepEvent(1), stepEvent(2)]);
		expect(within(stepsList()).getAllByRole("listitem")).toHaveLength(2);
	});

	it("explains a fatal error", async () => {
		const source = await renderLive();
		await emitAll(source, [
			{ type: "error", runId: RUN_ID, at: at(2), message: "Chromium exited", fatal: true },
		]);
		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Chromium exited");
		expect(alert).toHaveTextContent(/no verdict/i);
		expect(screen.getByRole("status", { name: /run status/i })).toHaveTextContent("ERROR");
		expect(screen.queryByRole("button", { name: /cancel run/i })).not.toBeInTheDocument();
		expect(source.closed).toBe(true);
	});

	it("cancels through the API", async () => {
		const cancelled = vi.fn();
		server.use(
			http.post("*/api/runs/:id/cancel", ({ params }) => {
				cancelled(params.id);
				return new HttpResponse(null, { status: 204 });
			}),
		);
		await renderLive();
		fireEvent.click(screen.getByRole("button", { name: /cancel run/i }));
		await waitFor(() => expect(cancelled).toHaveBeenCalledWith(RUN_ID));
	});
});

describe("RunDetailPage (finished)", () => {
	beforeEach(() => {
		FakeEventSource.instances = [];
		vi.stubGlobal("EventSource", FakeEventSource);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders a finished run from the stored verdict and history without opening a stream", async () => {
		renderAt(`/runs/${fx.PASSED_RUN_ID}`);
		const verdictPanel = await screen.findByRole("region", { name: /verdict/i });
		expect(within(verdictPanel).getByRole("meter")).toHaveAttribute(
			"aria-valuenow",
			String(Math.round(fx.verdict.score * 100)),
		);
		expect(verdictPanel).toHaveTextContent(fx.verdict.summary);
		expect(screen.getByTitle(/report/i)).toHaveAttribute(
			"src",
			`/api/runs/${fx.PASSED_RUN_ID}/report`,
		);
		expect(screen.getByRole("region", { name: /run overview/i })).toHaveTextContent(
			turn(fx.verdict.turns_used, fx.verdict.max_turns),
		);
		expect(screen.getByRole("region", { name: /run overview/i })).toHaveTextContent("4m 12s");
		await waitFor(() => expect(within(stepsList()).getAllByRole("listitem")).toHaveLength(3));
		expect(screen.getByRole("region", { name: /transcript/i })).toHaveTextContent("4471");
		expect(FakeEventSource.instances).toHaveLength(0);
		expect(screen.queryByRole("button", { name: /cancel run/i })).not.toBeInTheDocument();
	});

	it("reports a missing run", async () => {
		renderAt("/runs/does-not-exist");
		expect(await screen.findByRole("alert")).toHaveTextContent(/not found/i);
		expect(FakeEventSource.instances).toHaveLength(0);
	});
});
