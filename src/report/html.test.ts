import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { TINY_PNG } from "../testing/fake-browser-session.js";
import { failedMaxTurnsFixture, passedFixture } from "./fixtures/index.js";
import { renderHtml } from "./html.js";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Matches an `<img>` tag whose `src` attribute equals `src` exactly. */
const imgWithSrc = (src: string) => new RegExp(`<img[^>]*\\ssrc="${escapeRegExp(src)}"`);

describe("renderHtml", () => {
	it("is a self-contained document with no external assets", async () => {
		const html = await renderHtml(passedFixture());
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain('<html lang="en">');
		expect(html).toContain("<style>");
		expect(html).not.toMatch(/<link\s[^>]*href=/i);
		expect(html).not.toMatch(/<script\s[^>]*src=/i);
		expect(html).not.toMatch(/https?:\/\/(cdn|fonts|unpkg)/i);
	});

	it("shows the header: scenario, persona, target, models, status badge, score, threshold, turns", async () => {
		const html = await renderHtml(passedFixture());
		expect(html).toContain("invoice-export-september");
		expect(html).toContain("impatient-smb-owner");
		expect(html).toContain("demo-chatbot");
		expect(html).toContain("http://localhost:3999");
		expect(html).toContain("anthropic:sim-model");
		expect(html).toContain("anthropic:judge-model");
		expect(html).toMatch(/class="badge[^"]*"[^>]*>PASSED</);
		expect(html).toContain("96%");
		expect(html).toContain("70%");
		expect(html).toMatch(/3\s*\/\s*6/);
	});

	it("renders the FAILED badge and the max-turns outcome", async () => {
		const html = await renderHtml(failedMaxTurnsFixture());
		expect(html).toMatch(/class="badge[^"]*"[^>]*>FAILED</);
		expect(html).toContain("33%");
		expect(html).toMatch(/4\s*\/\s*4/);
		expect(html).toContain("max_turns");
	});

	it("lists every criterion with type, weight, required, score %, pass and evidence anchors", async () => {
		const input = passedFixture();
		const html = await renderHtml(input);
		for (const c of input.verdict.criteria) expect(html).toContain(c.id);
		expect(html).toContain("<th");
		expect(html).toContain("max_response_time_ms");
		expect(html).toContain("no_console_errors");
		expect(html).toContain("80%");
		expect(html).toContain(
			"A PDF named invoice-2026-09.pdf was downloaded in step 6 and the bot confirmed it is the September invoice for customer 4471.",
		);
		// evidence with a screenshot links to that screenshot's anchor; step-only evidence links to the step
		expect(html).toMatch(/href="#shot-steps-006-after-png"/);
		expect(html).toMatch(/id="shot-steps-006-after-png"/);
		expect(html).toMatch(/href="#turn-1"/);
	});

	it("renders every transcript message, escaped", async () => {
		const input = failedMaxTurnsFixture();
		const html = await renderHtml(input);
		for (const entry of input.transcript) {
			if (entry.text.includes("<")) continue;
			expect(html).toContain(entry.text);
		}
		expect(html).not.toContain('<script>alert("xss")</script>');
		expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
	});

	it("escapes attributes built from model text", async () => {
		const input = passedFixture();
		input.resolved.scenario.name = 'x" onmouseover="alert(1)';
		input.run.scenario = input.resolved.scenario.name;
		const html = await renderHtml(input);
		expect(html).not.toContain('onmouseover="alert(1)');
	});

	it("escapes fields typed as numbers or enums too: renderHtml is public API and run.json is plain data", async () => {
		const input = passedFixture();
		const [criterion] = input.verdict.criteria;
		const [step] = input.steps;
		const [message] = input.transcript;
		const [download] = input.downloads;
		const [entry] = input.console;
		if (!criterion || !step || !message || !download || !entry) throw new Error("fixture changed");
		input.run.repeat_total = 2;
		const sinks: Array<[object, string]> = [
			[input.run, "repeat_index"],
			[input.verdict, "status"],
			[input.verdict, "turns_used"],
			[input.verdict, "max_turns"],
			[criterion, "weight"],
			[step, "index"],
			[message, "role"],
			[message, "step"],
			[message, "turn"],
			[download, "mime"],
			[download, "step"],
			[download, "turn"],
			[entry, "level"],
			[entry, "step"],
		];
		for (const [target, key] of sinks) {
			const name = `${target === input.run ? "run" : target === input.verdict ? "verdict" : "item"}.${key}`;
			(target as Record<string, unknown>)[key] = `"><b data-injected="${name}">x</b>`;
		}
		const html = await renderHtml(input);
		const doc = new JSDOM(html).window.document;
		const injected = [...doc.querySelectorAll("[data-injected]")].map((el) =>
			el.getAttribute("data-injected"),
		);
		expect(injected).toEqual([]);
		expect(html).not.toContain("<b data-injected=");
	});

	it("references screenshots by relative path and shows per-turn screenshots in the transcript", async () => {
		const html = await renderHtml(passedFixture());
		expect(html).toMatch(imgWithSrc("steps/003/after.png"));
		expect(html).toMatch(/<img[^>]*\salt="[^"]+"/);
		expect(html).not.toMatch(/<img[^>]*\salt=""/);
		const turn2 = /<section[^>]*id="turn-2"[\s\S]*?<\/section>/.exec(html)?.[0];
		expect(turn2).toBeDefined();
		expect(turn2).toContain("4471");
		expect(turn2).toMatch(imgWithSrc("steps/004/after.png"));
		expect(turn2).toContain("2900 ms");
	});

	it("inlines screenshots as data URIs through the injected loader", async () => {
		const requested: string[] = [];
		const html = await renderHtml(passedFixture(), {
			inlineImages: true,
			imageLoader: async (path) => {
				requested.push(path);
				return path === "steps/004/after.png" ? undefined : TINY_PNG;
			},
		});
		const dataUri = `data:image/png;base64,${Buffer.from(TINY_PNG).toString("base64")}`;
		expect(html).toMatch(imgWithSrc(dataUri));
		expect(html).not.toMatch(imgWithSrc("steps/003/after.png"));
		// a missing image falls back to the relative path instead of breaking the report
		expect(html).toMatch(imgWithSrc("steps/004/after.png"));
		expect(requested).toContain("steps/003/interim-1.png");
		expect(new Set(requested).size).toBe(requested.length);
	});

	it("puts interim captures in the filmstrip entry of the step they belong to", async () => {
		const html = await renderHtml(passedFixture());
		const step3 = /<figure[^>]*id="step-3"[\s\S]*?<\/figure>/.exec(html)?.[0];
		expect(step3).toBeDefined();
		expect(step3).toMatch(imgWithSrc("steps/003/before.png"));
		expect(step3).toMatch(imgWithSrc("steps/003/interim-1.png"));
		expect(step3).toMatch(imgWithSrc("steps/003/interim-2.png"));
		expect(step3).toMatch(imgWithSrc("steps/003/after.png"));
		expect(step3).not.toMatch(imgWithSrc("steps/004/interim-1.png"));
		expect(step3).toContain("need my invoice for septmber as pdf");
		const step1 = /<figure[^>]*id="step-1"[\s\S]*?<\/figure>/.exec(html)?.[0];
		expect(step1).toContain("open");
		expect(step1).toContain("http://localhost:3999");
	});

	it("lists downloads with mime, size and extracted excerpt, console errors and the judge texts", async () => {
		const input = passedFixture();
		const html = await renderHtml(input);
		expect(html).toContain('href="downloads/invoice-2026-09.pdf"');
		expect(html).toContain("application/pdf");
		expect(html).toContain("18.0 kB");
		expect(html).toContain("Customer: 4471 (Marta&#39;s Bakery)");
		expect(html).toContain("404 (favicon.ico)");
		expect(html).toContain(input.verdict.summary);
		expect(html).toContain(input.verdict.goal_assessment ?? "");
	});

	it("embeds the raw JSON in a collapsible, escaped", async () => {
		const input = failedMaxTurnsFixture();
		const html = await renderHtml(input);
		expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>[^<]*Raw JSON/i);
		expect(html).toContain(
			"&quot;runId&quot;: &quot;20261019-101233-invoice-export-september&quot;",
		);
		expect(html).not.toContain('"runId": "20261019');
	});

	it("is accessible: one h1, no skipped heading levels, focus-visible styles, table headers", async () => {
		const html = await renderHtml(passedFixture());
		expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
		const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
		for (let i = 1; i < levels.length; i++) {
			const prev = levels[i - 1] ?? 1;
			const cur = levels[i] ?? 1;
			expect(cur - prev).toBeLessThanOrEqual(1);
		}
		expect(html).toContain(":focus-visible");
		expect(html).toContain("prefers-color-scheme: dark");
		expect(html).toContain("prefers-reduced-motion");
		expect(html).toMatch(/<th scope="col"/);
	});

	it("parses as a DOM with unique ids, resolvable in-page anchors and a working inline script", async () => {
		for (const input of [passedFixture(), failedMaxTurnsFixture()]) {
			const html = await renderHtml(input);
			const errors: unknown[] = [];
			const dom = new JSDOM(html, { runScripts: "dangerously" });
			dom.window.addEventListener("error", (e) => errors.push(e));
			const doc = dom.window.document;
			const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
			expect(new Set(ids).size).toBe(ids.length);
			const anchors = [...doc.querySelectorAll('a[href^="#"]')].map((a) =>
				a.getAttribute("href")?.slice(1),
			);
			expect(anchors.length).toBeGreaterThan(10);
			for (const id of anchors) expect(ids, `anchor #${id}`).toContain(id);
			expect(doc.querySelectorAll("img:not([alt])")).toHaveLength(0);
			expect(doc.querySelector("main")).not.toBeNull();
			expect(errors).toEqual([]);
			// the inline script wires the expand/collapse buttons
			doc.querySelector<HTMLButtonElement>('[data-toggle="close"]')?.click();
			expect(
				[...doc.querySelectorAll("main details")].every((d) => !(d as HTMLDetailsElement).open),
			).toBe(true);
			doc.querySelector<HTMLButtonElement>('[data-toggle="open"]')?.click();
			expect(
				[...doc.querySelectorAll("main details")].every((d) => (d as HTMLDetailsElement).open),
			).toBe(true);
		}
	});

	it("is deterministic for the same input", async () => {
		const [a, b] = await Promise.all([renderHtml(passedFixture()), renderHtml(passedFixture())]);
		expect(a).toBe(b);
	});

	it("matches the golden snapshot for the PASSED fixture", async () => {
		const html = await renderHtml(passedFixture());
		await expect(html).toMatchFileSnapshot("./__snapshots__/report-passed.html.txt");
	});
});
