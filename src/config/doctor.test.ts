import { describe, expect, it } from "vitest";
import { SettingsSchema } from "../schemas/index.js";
import { runDoctor } from "./doctor.js";
import { StaticSecretsProvider } from "./secrets.js";

const settings = SettingsSchema.parse({
	models: { simulator: "openai:gpt-5", judge: "anthropic:claude-sonnet-5-5" },
});

describe("runDoctor", () => {
	it("reports every check failing with fix hints in an empty environment", async () => {
		const checks = await runDoctor({
			secrets: new StaticSecretsProvider({}),
			settings,
			workspaceRoot: "/ws",
			exists: () => false,
			chromiumExecutablePath: () => "/opt/chromium/chrome",
		});
		expect(checks.length).toBeGreaterThan(0);
		for (const check of checks) {
			expect(check.ok).toBe(false);
			expect(check.fix).toBeTruthy();
		}
		const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
		expect(byId["provider:anthropic"]?.fix).toContain("export ANTHROPIC_API_KEY=");
		expect(byId["browser:chromium"]?.fix).toContain("npx playwright install chromium");
		expect(byId["browser:chromium"]?.detail).toContain("/opt/chromium/chrome");
		expect(byId["workspace:settings"]?.detail).toContain("agent-evaluator.yaml");
		expect(byId["model:simulator"]?.detail).toContain("openai:gpt-5");
		expect(byId["model:simulator"]?.fix).toContain("OPENAI_API_KEY");
		expect(byId["model:judge"]?.fix).toContain("ANTHROPIC_API_KEY");
	});

	it("passes when keys, chromium and workspace files are present", async () => {
		const seen: string[] = [];
		const checks = await runDoctor({
			secrets: new StaticSecretsProvider({ OPENAI_API_KEY: "k1", ANTHROPIC_API_KEY: "k2" }),
			settings,
			workspaceRoot: "/ws",
			exists: (p) => {
				seen.push(p);
				return true;
			},
			chromiumExecutablePath: () => "/opt/chromium/chrome",
		});
		const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
		expect(byId["provider:openai"]?.ok).toBe(true);
		expect(byId["provider:anthropic"]?.ok).toBe(true);
		expect(byId["provider:groq"]?.ok).toBe(false);
		expect(byId["browser:chromium"]?.ok).toBe(true);
		expect(byId["workspace:settings"]?.ok).toBe(true);
		expect(byId["workspace:evaluator"]?.ok).toBe(true);
		expect(byId["workspace:personas"]?.ok).toBe(true);
		expect(byId["model:simulator"]?.ok).toBe(true);
		expect(byId["model:judge"]?.ok).toBe(true);
		expect(byId["model:evidence_selector"]).toBeUndefined();
		expect(seen).toContain("/opt/chromium/chrome");
		expect(seen).toContain("/ws/agent-evaluator.yaml");
		expect(seen).toContain("/ws/evaluator.yaml");
		expect(seen).toContain("/ws/personas");
		expect(JSON.stringify(checks)).not.toContain("k1");
	});

	it("treats a throwing executablePath (playwright not installed) as a failed browser check", async () => {
		const checks = await runDoctor({
			secrets: new StaticSecretsProvider({}),
			settings,
			workspaceRoot: "/ws",
			exists: () => true,
			chromiumExecutablePath: () => {
				throw new Error("no browsers");
			},
		});
		const chromium = checks.find((c) => c.id === "browser:chromium");
		expect(chromium?.ok).toBe(false);
		expect(chromium?.detail).toContain("no browsers");
	});

	it("flags an evidence_selector pointing at an unknown provider", async () => {
		const checks = await runDoctor({
			secrets: new StaticSecretsProvider({ OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }),
			settings: SettingsSchema.parse({
				models: { ...settings.models, evidence_selector: "nope:model" },
			}),
			workspaceRoot: "/ws",
			exists: () => true,
			chromiumExecutablePath: () => "/opt/chromium/chrome",
		});
		const check = checks.find((c) => c.id === "model:evidence_selector");
		expect(check?.ok).toBe(false);
		expect(check?.detail).toContain("nope");
	});

	describe("target reachability", () => {
		const base = {
			secrets: new StaticSecretsProvider({ OPENAI_API_KEY: "k1", ANTHROPIC_API_KEY: "k2" }),
			settings,
			workspaceRoot: "/ws",
			exists: () => true,
			chromiumExecutablePath: () => "/opt/chromium/chrome",
		};

		it("probes nothing when no targets are given", async () => {
			let calls = 0;
			const checks = await runDoctor({
				...base,
				fetch: async () => {
					calls += 1;
					return new Response("");
				},
			});
			expect(calls).toBe(0);
			expect(checks.some((c) => c.id.startsWith("target:"))).toBe(false);
		});

		it("reports a target as reachable on any HTTP response", async () => {
			const seen: string[] = [];
			const checks = await runDoctor({
				...base,
				targets: [{ name: "demo-chatbot", url: "http://localhost:3999" }],
				fetch: async (input, init) => {
					seen.push(String(input));
					expect(init?.signal).toBeInstanceOf(AbortSignal);
					return new Response("nope", { status: 404 });
				},
			});
			const check = checks.find((c) => c.id === "target:demo-chatbot");
			expect(seen).toEqual(["http://localhost:3999"]);
			expect(check).toMatchObject({ ok: true, label: "Target demo-chatbot" });
			expect(check?.detail).toBe("reachable at http://localhost:3999 (HTTP 404)");
			expect(check?.fix).toBeUndefined();
		});

		it("reports the connection error code and a start-or-fix hint when the probe fails", async () => {
			const checks = await runDoctor({
				...base,
				targets: [
					{ name: "demo-chatbot", url: "http://localhost:3999" },
					{ name: "staging", url: "https://bot.example.test" },
				],
				fetch: async (input) => {
					if (String(input).includes("3999")) {
						throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
					}
					throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
				},
			});
			const demo = checks.find((c) => c.id === "target:demo-chatbot");
			expect(demo?.ok).toBe(false);
			expect(demo?.detail).toBe("not reachable at http://localhost:3999 (ECONNREFUSED)");
			expect(demo?.fix).toContain("agent-evaluator demo");
			expect(demo?.fix).toContain("targets/demo-chatbot.yaml");
			const staging = checks.find((c) => c.id === "target:staging");
			expect(staging?.detail).toBe("not reachable at https://bot.example.test (timed out)");
			expect(staging?.fix).toContain("targets/staging.yaml");
		});

		it("gives up on a hanging target after the timeout", async () => {
			const checks = await runDoctor({
				...base,
				targets: [{ name: "slow", url: "http://localhost:1" }],
				targetTimeoutMs: 20,
				fetch: (_input, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
					}),
			});
			const slow = checks.find((c) => c.id === "target:slow");
			expect(slow?.ok).toBe(false);
			expect(slow?.detail).toContain("timed out");
		});
	});
});
