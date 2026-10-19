import { describe, expect, it } from "vitest";
import type { BrowserSession } from "../browser/types.js";
import { FakeBrowserSession, TINY_PNG } from "./fake-browser-session.js";

describe("FakeBrowserSession", () => {
	it("satisfies the BrowserSession contract and records calls", async () => {
		const session: BrowserSession = new FakeBrowserSession({
			replies: ["Hello! How can I help?"],
		});
		await session.open("http://localhost:3999");
		const before = await session.snapshot();
		expect(before.tree).toContain("[ref=e1]");
		await session.type("e1", "hi", { submit: true });
		const result = await session.waitForReplyStable({ timeoutMs: 1000, stableMs: 10 });
		expect(result.stable).toBe(true);
		expect(result.snapshot.tree).toContain("Hello! How can I help?");
		const shot = await session.screenshot();
		expect(shot.png).toBe(TINY_PNG);
		await session.close();
		const fake = session as FakeBrowserSession;
		expect(fake.calls.map((c) => c.method)).toEqual([
			"open",
			"snapshot",
			"type",
			"waitForReplyStable",
			"snapshot",
			"screenshot",
			"close",
		]);
		expect(fake.closed).toBe(true);
	});

	it("throws on unscripted downloads", async () => {
		const session = new FakeBrowserSession();
		await expect(session.download("e9")).rejects.toThrow(/no scripted download/);
	});
});
