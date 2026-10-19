/**
 * Minimal typing for the `jsdom` dev dependency, which ships no types and has no `@types` package
 * installed. Used only by tests (e.g. parsing JUnit XML with `DOMParser`).
 */
declare module "jsdom" {
	export class JSDOM {
		constructor(html?: string, options?: { runScripts?: "dangerously" | "outside-only" });
		readonly window: Window & typeof globalThis;
	}
}
