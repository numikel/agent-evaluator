import type { RunEvent } from "@schemas/run";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeRunEvents } from "./sse.js";

type Listener = (event: MessageEvent<string>) => void;

/** Minimal EventSource stand-in: jsdom ships none, and tests must not open sockets. */
class FakeEventSource {
	static instances: FakeEventSource[] = [];
	readonly url: string;
	onmessage: Listener | null = null;
	onerror: ((event: Event) => void) | null = null;
	closed = false;
	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}
	emit(data: string) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}
	close() {
		this.closed = true;
	}
}

describe("subscribeRunEvents", () => {
	beforeEach(() => {
		FakeEventSource.instances = [];
		vi.stubGlobal("EventSource", FakeEventSource);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("opens the run's event stream and delivers parsed RunEvents", () => {
		const received: RunEvent[] = [];
		subscribeRunEvents("run-1", (event) => received.push(event));
		const source = FakeEventSource.instances[0];
		expect(source?.url).toBe("/api/runs/run-1/events");
		source?.emit(
			JSON.stringify({
				type: "status",
				runId: "run-1",
				at: "2026-10-19T10:00:00.000Z",
				status: "RUNNING",
			}),
		);
		expect(received).toEqual([
			{ type: "status", runId: "run-1", at: "2026-10-19T10:00:00.000Z", status: "RUNNING" },
		]);
	});

	it("ignores malformed lines and events that fail schema validation", () => {
		const received: RunEvent[] = [];
		subscribeRunEvents("run-1", (event) => received.push(event));
		const source = FakeEventSource.instances[0];
		source?.emit("not json");
		source?.emit(JSON.stringify({ type: "status", runId: "run-1" }));
		source?.emit(JSON.stringify({ type: "teleport", runId: "run-1", at: "x" }));
		expect(received).toEqual([]);
	});

	it("returns an unsubscribe function that closes the stream", () => {
		const unsubscribe = subscribeRunEvents("run-2", () => {});
		const source = FakeEventSource.instances[0];
		expect(source?.closed).toBe(false);
		unsubscribe();
		expect(source?.closed).toBe(true);
	});

	it("reports stream errors to the optional onError callback", () => {
		const onError = vi.fn();
		subscribeRunEvents("run-3", () => {}, { onError });
		FakeEventSource.instances[0]?.onerror?.(new Event("error"));
		expect(onError).toHaveBeenCalledTimes(1);
	});
});
