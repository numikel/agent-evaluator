import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_REF, ValidationError } from "../schemas/index.js";
import { resolveSettings, SETTINGS_ENV_VARS } from "./settings.js";

describe("resolveSettings", () => {
	it("returns schema defaults when nothing is given", () => {
		const settings = resolveSettings({ env: {} });
		expect(settings.models).toEqual({ simulator: DEFAULT_MODEL_REF, judge: DEFAULT_MODEL_REF });
		expect(settings.server).toEqual({ host: "127.0.0.1", port: 4747 });
		expect(settings.browser).toEqual({ headless: true, slow_mo_ms: 0 });
		expect(settings.runs_dir).toBe("runs");
		expect(settings.concurrency).toBe(1);
	});

	it("applies the file layer", () => {
		const settings = resolveSettings({
			file: { models: { judge: "openai:gpt-5" }, server: { port: 5000 }, runs_dir: "out" },
			env: {},
		});
		expect(settings.models.judge).toBe("openai:gpt-5");
		expect(settings.models.simulator).toBe(DEFAULT_MODEL_REF);
		expect(settings.server.port).toBe(5000);
		expect(settings.runs_dir).toBe("out");
	});

	it("env overrides file", () => {
		const settings = resolveSettings({
			file: {
				models: { simulator: "openai:gpt-5", judge: "openai:gpt-5" },
				server: { port: 5000 },
				browser: { headless: true },
				runs_dir: "out",
			},
			env: {
				AE_PORT: "6000",
				AE_RUNS_DIR: "/tmp/runs",
				AE_HEADLESS: "false",
				AE_MODEL_SIMULATOR: "groq:llama-3.3-70b-versatile",
				AE_MODEL_JUDGE: "anthropic:claude-sonnet-5-5",
			},
		});
		expect(settings.server.port).toBe(6000);
		expect(settings.server.host).toBe("127.0.0.1");
		expect(settings.runs_dir).toBe("/tmp/runs");
		expect(settings.browser.headless).toBe(false);
		expect(settings.browser.slow_mo_ms).toBe(0);
		expect(settings.models.simulator).toBe("groq:llama-3.3-70b-versatile");
		expect(settings.models.judge).toBe("anthropic:claude-sonnet-5-5");
	});

	it("cli overrides env and file", () => {
		const settings = resolveSettings({
			file: { server: { port: 5000 } },
			env: { AE_PORT: "6000", AE_HEADLESS: "0" },
			cli: { server: { port: 7000, host: "0.0.0.0" }, browser: { headless: true } },
		});
		expect(settings.server).toEqual({ port: 7000, host: "0.0.0.0" });
		expect(settings.browser.headless).toBe(true);
	});

	it("ignores unrelated and empty env vars", () => {
		const settings = resolveSettings({ env: { PATH: "/bin", AE_PORT: "", HOME: "/" } });
		expect(settings.server.port).toBe(4747);
	});

	it("accepts the usual boolean spellings for AE_HEADLESS", () => {
		for (const v of ["1", "true", "yes", "on", "TRUE"])
			expect(resolveSettings({ env: { AE_HEADLESS: v } }).browser.headless).toBe(true);
		for (const v of ["0", "false", "no", "off", "False"])
			expect(resolveSettings({ env: { AE_HEADLESS: v } }).browser.headless).toBe(false);
	});

	it("throws ValidationError for an invalid env value, naming the variable", () => {
		expect(() => resolveSettings({ env: { AE_PORT: "abc" } })).toThrow(ValidationError);
		try {
			resolveSettings({ env: { AE_PORT: "abc" } });
		} catch (error) {
			const e = error as ValidationError;
			expect(e.source).toBe("environment");
			expect(e.issues[0]?.path).toBe("AE_PORT");
		}
		expect(() => resolveSettings({ env: { AE_HEADLESS: "maybe" } })).toThrow(/AE_HEADLESS/);
		expect(() => resolveSettings({ env: { AE_MODEL_JUDGE: "gpt-5" } })).toThrow(/provider:model/);
		expect(() => resolveSettings({ env: { AE_PORT: "70000" } })).toThrow(ValidationError);
	});

	it("throws ValidationError for an invalid file layer with its source", () => {
		expect(() =>
			resolveSettings({ file: { concurrency: 0 }, env: {}, source: "agent-evaluator.yaml" }),
		).toThrow(/agent-evaluator.yaml/);
	});

	it("documents the supported env vars", () => {
		expect(SETTINGS_ENV_VARS).toEqual([
			"AE_PORT",
			"AE_RUNS_DIR",
			"AE_HEADLESS",
			"AE_MODEL_SIMULATOR",
			"AE_MODEL_JUDGE",
		]);
	});
});
