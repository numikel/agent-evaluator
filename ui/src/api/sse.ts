/** Live run events over `GET /api/runs/:id/events` (SSE, `data:` holds one JSON RunEvent). */
import type { RunEvent } from "@schemas/run";
import { RunEventSchema } from "@schemas/run";

export type RunEventListener = (event: RunEvent) => void;

export type SubscribeOptions = {
	/** Called on transport errors; `EventSource` reconnects on its own, so this is informational. */
	onError?: (event: Event) => void;
	/**
	 * Called whenever the connection (re)opens. The server replays the whole history on every
	 * connection, so a page that saw an error should reset its state here before new events land.
	 */
	onOpen?: () => void;
};

/** Parses one SSE `data:` payload; returns `undefined` for malformed JSON or unknown shapes. */
export function parseRunEvent(data: unknown): RunEvent | undefined {
	if (typeof data !== "string") return undefined;
	let json: unknown;
	try {
		json = JSON.parse(data);
	} catch {
		return undefined;
	}
	const result = RunEventSchema.safeParse(json);
	return result.success ? result.data : undefined;
}

/**
 * Subscribes to a run's event stream. Malformed messages are dropped silently.
 * @returns an unsubscribe function that closes the connection.
 */
export function subscribeRunEvents(
	runId: string,
	onEvent: RunEventListener,
	options: SubscribeOptions = {},
): () => void {
	const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
	source.onmessage = (message: MessageEvent<unknown>) => {
		const event = parseRunEvent(message.data);
		if (event) onEvent(event);
	};
	source.onerror = (event: Event) => {
		options.onError?.(event);
	};
	source.onopen = () => {
		options.onOpen?.();
	};
	return () => source.close();
}
