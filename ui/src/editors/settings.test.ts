import type { Settings } from "@schemas/settings";
import { describe, expect, it } from "vitest";
import { buildSettings, parseModelRef, type SettingsDraft, toDraft } from "./settings.js";

const base: Settings = {
	models: { simulator: "anthropic:model-a", judge: "anthropic:model-b" },
	browser: { headless: true, slow_mo_ms: 0 },
	concurrency: 1,
	runs_dir: "runs",
	server: { port: 4747, host: "127.0.0.1" },
};

describe("settings draft", () => {
	it("splits model refs on the first colon", () => {
		expect(parseModelRef("openrouter:vendor/model:free")).toEqual({
			provider: "openrouter",
			model: "vendor/model:free",
		});
		expect(parseModelRef(undefined)).toEqual({ provider: "", model: "" });
	});

	it("maps settings to a draft and back without inventing optional sections", () => {
		const draft = toDraft(base);
		expect(draft.roles.simulator).toEqual({
			provider: "anthropic",
			model: "model-a",
			effort: "",
			temperature: "",
		});
		expect(draft.roles.evidence_selector.provider).toBe("");
		const out = buildSettings(draft);
		expect(out).toEqual(base);
		expect(out).not.toHaveProperty("effort");
		expect(out).not.toHaveProperty("temperature");
		expect(out.models).not.toHaveProperty("evidence_selector");
	});

	it("emits effort and temperature only for roles that set them", () => {
		const draft: SettingsDraft = toDraft(base);
		draft.roles.judge = { provider: "openai", model: "m", effort: "high", temperature: "0.2" };
		draft.roles.evidence_selector = { provider: "ollama", model: "x", effort: "", temperature: "" };
		const out = buildSettings(draft);
		expect(out.models).toEqual({
			simulator: "anthropic:model-a",
			judge: "openai:m",
			evidence_selector: "ollama:x",
		});
		expect(out.effort).toEqual({ judge: "high" });
		expect(out.temperature).toEqual({ judge: 0.2 });
	});

	it("keeps browser, concurrency, runs dir and server settings", () => {
		const draft = toDraft(base);
		draft.browser = { headless: false, slow_mo_ms: "250" };
		draft.concurrency = "4";
		draft.runs_dir = "out";
		const out = buildSettings(draft);
		expect(out.browser).toEqual({ headless: false, slow_mo_ms: 250 });
		expect(out.concurrency).toBe(4);
		expect(out.runs_dir).toBe("out");
		expect(out.server).toEqual(base.server);
	});
});
