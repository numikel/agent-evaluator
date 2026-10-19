import { useEffect, useRef, useState } from "react";

export type AsyncState<T> =
	| { status: "loading" }
	| { status: "ready"; data: T }
	| { status: "error"; message: string };

export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Runs `load` on mount and whenever `key` changes (the key is passed to it); a stale result
 * from a superseded call is ignored. Loads that need several requests should `Promise.all`
 * inside `load`. The latest `load` is always used, so callers can pass an inline closure.
 */
export function useAsync<T>(load: (key: string) => Promise<T>, key: string): AsyncState<T> {
	const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
	const latest = useRef(load);
	useEffect(() => {
		latest.current = load;
	});
	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		latest.current(key).then(
			(data) => {
				if (!cancelled) setState({ status: "ready", data });
			},
			(error: unknown) => {
				if (!cancelled) setState({ status: "error", message: errorMessage(error) });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [key]);
	return state;
}
