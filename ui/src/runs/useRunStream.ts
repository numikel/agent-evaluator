/**
 * Loads a run and keeps its {@link RunViewState} current.
 *
 * - `GET /api/runs/:id` seeds the state. A finished run is rendered from the stored record and
 *   verdict, enriched with the persisted `events.jsonl` (fetched as an artifact) so the evidence
 *   strip and transcript are available without a stream.
 * - A run that is still going subscribes to the SSE stream. Events are queued and folded into
 *   the state in one `startTransition` per microtask, so a burst of hundreds of `step` events
 *   costs one render instead of hundreds.
 * - The server replays the whole history on every connection; after a transport error the
 *   state is reset on reopen so the replay cannot double anything up (the reducer is keyed too).
 */
import type { RunEvent } from "@schemas/run";
import { startTransition, useEffect, useRef, useState } from "react";
import { endpoints, resolveUrl } from "../api/client.js";
import { parseRunEvent, subscribeRunEvents } from "../api/sse.js";
import { errorMessage } from "../hooks/useAsync.js";
import type { RunViewState } from "./reducer.js";
import { applyRunEvent, fromDetail, initialRunState, isTerminalStatus } from "./reducer.js";

export type ConnectionState =
	| "loading"
	| "connecting"
	| "open"
	| "reconnecting"
	/** No stream: the run is finished, or the record could not be loaded. */
	| "closed"
	/** The browser has no `EventSource`. */
	| "unsupported";

export type RunStream = {
	state: RunViewState;
	connection: ConnectionState;
	loadError: string | undefined;
};

/** Persisted events of a finished run; empty when the file is missing or unreadable. */
async function loadHistory(runId: string): Promise<RunEvent[]> {
	try {
		const response = await fetch(resolveUrl(endpoints.artifactUrl(runId, "events.jsonl")));
		if (!response.ok) return [];
		const text = await response.text();
		return text
			.split(/\r?\n/)
			.map((line) => parseRunEvent(line))
			.filter((event): event is RunEvent => event !== undefined);
	} catch {
		return [];
	}
}

export function useRunStream(runId: string): RunStream {
	const [state, setState] = useState<RunViewState>(() => initialRunState(runId));
	const [connection, setConnection] = useState<ConnectionState>("loading");
	const [loadError, setLoadError] = useState<string | undefined>(undefined);
	const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
	const terminal = isTerminalStatus(state.status);

	useEffect(() => {
		let cancelled = false;
		let seed = initialRunState(runId);
		const queue: RunEvent[] = [];
		let scheduled = false;
		let resetPending = false;

		const flush = () => {
			scheduled = false;
			if (cancelled) return;
			const batch = queue.splice(0);
			const reset = resetPending;
			resetPending = false;
			if (batch.length === 0 && !reset) return;
			startTransition(() => {
				setState((prev) => batch.reduce(applyRunEvent, reset ? seed : prev));
			});
		};
		const schedule = () => {
			if (scheduled) return;
			scheduled = true;
			queueMicrotask(flush);
		};

		setState(initialRunState(runId));
		setConnection("loading");
		setLoadError(undefined);

		endpoints
			.run(runId)
			.then(async (detail) => {
				if (cancelled) return;
				seed = fromDetail(detail);
				setState(seed);
				if (isTerminalStatus(detail.run.status)) {
					setConnection("closed");
					const history = await loadHistory(runId);
					if (cancelled || history.length === 0) return;
					startTransition(() => setState(history.reduce(applyRunEvent, seed)));
					return;
				}
				if (typeof EventSource === "undefined") {
					setConnection("unsupported");
					return;
				}
				setConnection("connecting");
				let interrupted = false;
				unsubscribeRef.current = subscribeRunEvents(
					runId,
					(event) => {
						queue.push(event);
						schedule();
					},
					{
						onOpen: () => {
							if (interrupted) {
								interrupted = false;
								queue.length = 0;
								resetPending = true;
								schedule();
							}
							setConnection("open");
						},
						onError: () => {
							interrupted = true;
							setConnection("reconnecting");
						},
					},
				);
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setLoadError(errorMessage(error));
				setConnection("closed");
			});

		return () => {
			cancelled = true;
			unsubscribeRef.current?.();
			unsubscribeRef.current = undefined;
		};
	}, [runId]);

	// The server ends the stream after `done` / a fatal error; closing it here first keeps the
	// browser's automatic reconnect from flashing a "reconnecting" state on a finished run.
	useEffect(() => {
		if (!terminal || !unsubscribeRef.current) return;
		unsubscribeRef.current();
		unsubscribeRef.current = undefined;
		setConnection("closed");
	}, [terminal]);

	return { state, connection, loadError };
}

/** Milliseconds since `startedAt`, frozen at `finishedAt`; ticks once a second while running. */
export function useElapsedMs(
	startedAt: string | undefined,
	finishedAt: string | undefined,
): number | undefined {
	const running = startedAt !== undefined && finishedAt === undefined;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [running]);
	if (startedAt === undefined) return undefined;
	const start = Date.parse(startedAt);
	if (Number.isNaN(start)) return undefined;
	const end = finishedAt === undefined ? now : Date.parse(finishedAt);
	return Math.max(0, end - start);
}
