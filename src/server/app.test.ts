import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { RunPreconditionError } from "../runner/types.js";
import type { RunEvent, RunRecord } from "../schemas/index.js";
import { createApp } from "./app.js";
import { createFakeDeps, type FakeDeps } from "./testing.js";

const SECRET = "sk-fake-secret-value-0xDEADBEEF";
const silent = pino({ level: "silent" });

function setup(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
	const deps: FakeDeps = createFakeDeps();
	deps.secrets.set("OPENAI_API_KEY", SECRET);
	const app = createApp({ ...deps, heartbeatMs: 60_000, logger: silent, ...overrides });
	return { app, ...deps };
}

const PERSONA_MD = `---
name: alice
description: A curious tester.
language: en
traits: [curious]
---

# Background

Alice tests chatbots.
`;

const SCENARIO_YAML = `name: invoice
persona: alice
target: demo
rubric: basic
goal: Get the invoice.
intent: Download the September invoice as PDF.
success_criteria: A PDF invoice was downloaded.
max_turns: 5
`;

const RUBRIC_YAML = `name: basic
criteria:
  - id: polite
    type: llm
    description: The bot is polite.
`;

const TARGET_YAML = `name: demo
url: http://localhost:3999
`;

const EVALUATOR_YAML = `principles: Be helpful.
default_rubric: basic
`;

async function seedWorkspace(deps: FakeDeps) {
	await deps.workspace.writeRaw("persona", PERSONA_MD, "alice");
	await deps.workspace.writeRaw("scenario", SCENARIO_YAML, "invoice");
	await deps.workspace.writeRaw("rubric", RUBRIC_YAML, "basic");
	await deps.workspace.writeRaw("target", TARGET_YAML, "demo");
	await deps.workspace.writeRaw("evaluator", EVALUATOR_YAML);
}

function record(id: string, status: RunRecord["status"] = "RUNNING"): RunRecord {
	return {
		id,
		scenario: "invoice",
		persona: "alice",
		target: "demo",
		rubric: "basic",
		repeat_index: 1,
		repeat_total: 1,
		status,
		started_at: "2026-10-19T10:00:00.000Z",
		turns_used: 0,
		max_turns: 5,
		models: { simulator: "openai:gpt-test", judge: "openai:gpt-test" },
	};
}

function event(runId: string, partial: Record<string, unknown> & { type: RunEvent["type"] }) {
	return { runId, at: "2026-10-19T10:00:01.000Z", ...partial } as RunEvent;
}

const json = (body: unknown, method = "PUT") =>
	new Request("http://localhost/", {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

/** Reads an SSE body incrementally; the same reader is reused across calls within a test. */
function sseReader(res: Response) {
	const reader = res.body?.getReader();
	if (!reader) throw new Error("no body");
	const decoder = new TextDecoder();
	return {
		async readUntil(until: (text: string) => boolean): Promise<string> {
			let text = "";
			while (!until(text)) {
				const { done, value } = await reader.read();
				if (done) break;
				text += decoder.decode(value, { stream: true });
			}
			return text;
		},
		cancel: () => reader.cancel(),
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("GET /api/health", () => {
	it("returns ok and the package version", async () => {
		const { app } = setup({ version: "9.9.9" });
		const res = await app.request("/api/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, version: "9.9.9" });
	});
});

describe("workspace resources", () => {
	it("lists personas as ResourceSummary[]", async () => {
		const deps = setup();
		await seedWorkspace(deps);
		const res = await deps.app.request("/api/personas");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([
			expect.objectContaining({ name: "alice", description: "A curious tester." }),
		]);
	});

	it("GET /api/workspace returns the overview", async () => {
		const deps = setup();
		await seedWorkspace(deps);
		const res = await deps.app.request("/api/workspace");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.root).toBe(deps.workspace.root);
		expect(body.personas.map((p: { name: string }) => p.name)).toEqual(["alice"]);
		expect(body.scenarios.map((p: { name: string }) => p.name)).toEqual(["invoice"]);
		expect(body.has_evaluator).toBe(true);
		expect(body.has_settings).toBe(false);
	});

	it("GET /api/personas/:name returns a PersonaDocument", async () => {
		const deps = setup();
		await seedWorkspace(deps);
		const res = await deps.app.request("/api/personas/alice");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.frontmatter.name).toBe("alice");
		expect(body.frontmatter.traits).toEqual(["curious"]);
		expect(body.body).toContain("# Background");
		expect(body).not.toHaveProperty("path");
	});

	it("GET /api/personas/:name → 404 JSON when missing", async () => {
		const { app } = setup();
		const res = await app.request("/api/personas/nobody");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found", message: expect.any(String) });
	});

	it("PUT /api/personas/:name with invalid frontmatter → 422 with issues[]", async () => {
		const { app, workspace } = setup();
		const res = await app.request(
			"/api/personas/alice",
			json({ frontmatter: { name: "alice", description: "" }, body: "# Hi" }),
		);
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.error).toBe("validation_error");
		expect(body.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "frontmatter.description", message: expect.any(String) }),
			]),
		);
		expect(workspace.writes).toEqual([]);
	});

	it("PUT /api/personas/:name with a valid document → 204 and records the write", async () => {
		const { app, workspace } = setup();
		const res = await app.request(
			"/api/personas/alice",
			json({
				frontmatter: { name: "alice", description: "Tester" },
				body: "# Background\n\nHi.\n",
			}),
		);
		expect(res.status).toBe(204);
		expect(workspace.writes).toEqual([expect.objectContaining({ kind: "persona", name: "alice" })]);
		const persona = await workspace.loadPersona("alice");
		expect(persona.frontmatter.description).toBe("Tester");
		expect(persona.body.trim()).toBe("# Background\n\nHi.");
	});

	it("PUT /api/personas/:name rejects a frontmatter name that differs from the URL", async () => {
		const { app } = setup();
		const res = await app.request(
			"/api/personas/alice",
			json({ frontmatter: { name: "bob", description: "Tester" }, body: "x" }),
		);
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.issues[0].path).toBe("frontmatter.name");
	});

	it("PUT /api/scenarios/:name accepts the schema object and writes YAML", async () => {
		const { app, workspace } = setup();
		const res = await app.request(
			"/api/scenarios/invoice",
			json({
				name: "invoice",
				persona: "alice",
				target: "demo",
				goal: "g",
				intent: "i",
				success_criteria: "s",
				max_turns: 3,
			}),
		);
		expect(res.status).toBe(204);
		const raw = await workspace.readRaw("scenario", "invoice");
		expect(raw).toContain("max_turns: 3");
		const scenario = await workspace.loadScenario("invoice");
		expect(scenario.max_turns).toBe(3);
	});

	it("PUT /api/scenarios/:name accepts raw YAML when the content type is not JSON", async () => {
		const { app, workspace } = setup();
		const res = await app.request("/api/scenarios/invoice", {
			method: "PUT",
			headers: { "content-type": "application/yaml" },
			body: SCENARIO_YAML,
		});
		expect(res.status).toBe(204);
		expect(await workspace.readRaw("scenario", "invoice")).toBe(SCENARIO_YAML);
	});

	it("PUT /api/rubrics/:name with an invalid rubric → 422", async () => {
		const { app } = setup();
		const res = await app.request("/api/rubrics/basic", json({ name: "basic", criteria: [] }));
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.issues[0].path).toBe("criteria");
	});

	it("GET /api/scenarios/:name returns the parsed scenario with defaults", async () => {
		const deps = setup();
		await seedWorkspace(deps);
		const res = await deps.app.request("/api/scenarios/invoice");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ name: "invoice", max_turns: 5, repeat: 1 });
	});

	it("DELETE /api/personas/:name removes the file; unknown → 404", async () => {
		const deps = setup();
		await seedWorkspace(deps);
		const res = await deps.app.request("/api/personas/alice", { method: "DELETE" });
		expect(res.status).toBe(204);
		expect(await deps.workspace.list("persona")).toEqual([]);
		const again = await deps.app.request("/api/personas/alice", { method: "DELETE" });
		expect(again.status).toBe(404);
	});

	it("GET /api/evaluator and PUT /api/evaluator round-trip", async () => {
		const deps = setup();
		await seedWorkspace(deps);
		const res = await deps.app.request("/api/evaluator");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ principles: "Be helpful.", max_images: 10 });
		const put = await deps.app.request(
			"/api/evaluator",
			json({ principles: "Be brief.", max_images: 4 }),
		);
		expect(put.status).toBe(200);
		expect(await put.json()).toMatchObject({ principles: "Be brief.", max_images: 4 });
		expect(await deps.workspace.loadEvaluator()).toMatchObject({ principles: "Be brief." });
	});

	it("PUT /api/evaluator with invalid body → 422", async () => {
		const { app } = setup();
		const res = await app.request("/api/evaluator", json({ max_images: 999 }));
		expect(res.status).toBe(422);
	});
});

describe("POST /api/validate", () => {
	it("returns ok:false with issues for a scenario with max_turns 0", async () => {
		const { app } = setup();
		const res = await app.request(
			"/api/validate",
			json(
				{ kind: "scenario", content: SCENARIO_YAML.replace("max_turns: 5", "max_turns: 0") },
				"POST",
			),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.issues).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: "max_turns" })]),
		);
	});

	it("returns ok:true for a valid persona", async () => {
		const { app } = setup();
		const res = await app.request(
			"/api/validate",
			json({ kind: "persona", content: PERSONA_MD }, "POST"),
		);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("rejects an unknown kind with 422", async () => {
		const { app } = setup();
		const res = await app.request("/api/validate", json({ kind: "nope", content: "" }, "POST"));
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe("validation_error");
	});

	it("rejects a malformed JSON body with 422", async () => {
		const { app } = setup();
		const res = await app.request("/api/validate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect(res.status).toBe(422);
	});
});

describe("GET /api/templates/:kind", () => {
	it("serves the template as a text attachment", async () => {
		const { app } = setup();
		const res = await app.request("/api/templates/scenario");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
		expect(res.headers.get("content-disposition")).toBe('attachment; filename="scenario.yaml"');
		expect(await res.text()).toContain("max_turns");
	});

	it("persona template is PERSONA.md", async () => {
		const { app } = setup();
		const res = await app.request("/api/templates/persona");
		expect(res.headers.get("content-disposition")).toBe('attachment; filename="PERSONA.md"');
		expect(await res.text()).toMatch(/^---\n/);
	});

	it("unknown kind → 404", async () => {
		const { app } = setup();
		const res = await app.request("/api/templates/widget");
		expect(res.status).toBe(404);
	});
});

describe("providers", () => {
	it("GET /api/providers lists only configured providers and never values", async () => {
		const { app } = setup();
		const res = await app.request("/api/providers");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([
			{ id: "openai", label: "OpenAI", env: "OPENAI_API_KEY", configured: true },
		]);
	});

	it("GET /api/providers/openai/models proxies the registry", async () => {
		const { app, providers } = setup();
		providers.models.set("openai", [
			{ provider: "openai", id: "gpt-test", label: "GPT Test", ref: "openai:gpt-test" },
		]);
		const res = await app.request("/api/providers/openai/models");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ provider: "openai", source: "api" });
		expect(body.models).toEqual([expect.objectContaining({ ref: "openai:gpt-test" })]);
		expect(body.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(providers.listCalls).toEqual([{ providerId: "openai", refresh: false }]);
	});

	it("passes ?refresh=1 and flags fallbacks", async () => {
		const { app, providers } = setup();
		providers.failures.set("openai", "boom");
		const res = await app.request("/api/providers/openai/models?refresh=1");
		const body = await res.json();
		expect(body.source).toBe("fallback");
		expect(body.error).toBe("boom");
		expect(providers.listCalls).toEqual([{ providerId: "openai", refresh: true }]);
	});

	it("unknown or unconfigured provider → 404", async () => {
		const { app } = setup();
		expect((await app.request("/api/providers/nope/models")).status).toBe(404);
		expect((await app.request("/api/providers/anthropic/models")).status).toBe(404);
	});
});

describe("settings", () => {
	it("GET /api/settings returns settings, all providers with flags and browser_installed", async () => {
		const { app } = setup({ browserInstalled: async () => true });
		const res = await app.request("/api/settings");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.settings.models.simulator).toMatch(/^[a-z-]+:/);
		expect(body.settings.server.port).toBe(4747);
		expect(body.providers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "openai", configured: true }),
				expect.objectContaining({ id: "anthropic", configured: false }),
			]),
		);
		expect(body.browser_installed).toBe(true);
	});

	it("PUT /api/settings validates and writes YAML through the workspace", async () => {
		const { app, workspace } = setup({ browserInstalled: async () => false });
		const res = await app.request(
			"/api/settings",
			json({ models: { simulator: "openai:gpt-test", judge: "openai:gpt-test" }, concurrency: 2 }),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.settings.concurrency).toBe(2);
		expect(body.browser_installed).toBe(false);
		expect(workspace.writes).toEqual([expect.objectContaining({ kind: "settings" })]);
		expect(await workspace.readRaw("settings")).toContain("concurrency: 2");
	});

	it("PUT /api/settings with a bare model name → 422", async () => {
		const { app } = setup();
		const res = await app.request("/api/settings", json({ models: { simulator: "gpt-test" } }));
		expect(res.status).toBe(422);
		expect((await res.json()).issues[0].path).toBe("models.simulator");
	});
});

describe("runs", () => {
	it("POST /api/runs validates StartRunRequest and calls runner.start", async () => {
		const { app, runner } = setup();
		const res = await app.request("/api/runs", json({ scenario: "invoice", repeat: 2 }, "POST"));
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ runIds: ["run-1", "run-2"] });
		expect(runner.started).toEqual([{ scenario: "invoice", repeat: 2 }]);
	});

	it("POST /api/runs with an invalid body → 422", async () => {
		const { app, runner } = setup();
		const res = await app.request("/api/runs", json({ scenario: "Not A Slug" }, "POST"));
		expect(res.status).toBe(422);
		expect(runner.started).toEqual([]);
	});

	it("RunPreconditionError → 422", async () => {
		const { app, runner } = setup();
		runner.precondition = new RunPreconditionError("persona 'alice' not found");
		const res = await app.request("/api/runs", json({ scenario: "invoice" }, "POST"));
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.error).toBe("validation_error");
		expect(body.issues[0].message).toContain("persona 'alice' not found");
	});

	it("GET /api/runs lists run summaries", async () => {
		const { app, runStore } = setup();
		await runStore.create(record("r1"));
		const res = await app.request("/api/runs");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([expect.objectContaining({ id: "r1", status: "RUNNING" })]);
	});

	it("GET /api/runs/:id returns the record, verdict and has_report", async () => {
		const { app, runStore } = setup();
		await runStore.create(record("r1"));
		let res = await app.request("/api/runs/r1");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			run: expect.objectContaining({ id: "r1" }),
			has_report: false,
		});
		await runStore.saveReport("r1", {
			"report.html": "<html/>",
			"summary.json": "{}",
			"junit.xml": "<x/>",
		});
		res = await app.request("/api/runs/r1");
		expect((await res.json()).has_report).toBe(true);
	});

	it("GET /api/runs/:id → 404 for an unknown run", async () => {
		const { app } = setup();
		const res = await app.request("/api/runs/nope");
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe("not_found");
	});

	it("POST /api/runs/:id/cancel cancels an active run and 409s a finished one", async () => {
		const { app, runStore, runner } = setup();
		await runStore.create(record("r1"));
		await runStore.create(record("r2", "PASSED"));
		expect((await app.request("/api/runs/r1/cancel", { method: "POST" })).status).toBe(204);
		expect(runner.cancelled).toEqual(["r1"]);
		const res = await app.request("/api/runs/r2/cancel", { method: "POST" });
		expect(res.status).toBe(409);
		expect((await res.json()).error).toBe("not_cancellable");
		expect((await app.request("/api/runs/zzz/cancel", { method: "POST" })).status).toBe(404);
	});
});

describe("GET /api/runs/:id/events (SSE)", () => {
	it("replays events.jsonl history then streams live events and closes on done", async () => {
		const { app, runStore, runner } = setup();
		await runStore.create(record("r1"));
		await runStore.appendEvent("r1", event("r1", { type: "status", status: "RUNNING" }));
		await runStore.appendEvent("r1", event("r1", { type: "turn", turn: 1, max_turns: 5 }));

		const res = await app.request("/api/runs/r1/events");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);

		const sse = sseReader(res);
		const replayed = await sse.readUntil((t) => t.includes('"type":"turn"'));
		expect(replayed.indexOf('"type":"status"')).toBeLessThan(replayed.indexOf('"type":"turn"'));
		expect(replayed).toMatch(/^data: \{/);
		expect(replayed).toMatch(/\nid: 2\n\n/);

		await sleep(5);
		runner.emit(event("r1", { type: "log", level: "info", message: "live one" }));
		runner.emit(
			event("r1", {
				type: "done",
				verdict: {
					runId: "r1",
					status: "PASSED",
					goal_reached: true,
					score: 1,
					pass_threshold: 0.7,
					turns_used: 1,
					max_turns: 5,
					criteria: [],
					summary: "ok",
					judged_at: "2026-10-19T10:00:02.000Z",
					judge_model: "openai:gpt-test",
					evidence_screenshots: [],
				},
			}),
		);
		const rest = await sse.readUntil(() => false);
		expect(rest).toContain("live one");
		expect(rest.indexOf("live one")).toBeLessThan(rest.indexOf('"type":"done"'));
		expect(runner.listenerCount("r1")).toBe(0);
	});

	it("closes immediately when the history already ends with a fatal error", async () => {
		const { app, runStore, runner } = setup();
		await runStore.create(record("r1", "ERROR"));
		await runStore.appendEvent("r1", event("r1", { type: "error", message: "boom", fatal: true }));
		const res = await app.request("/api/runs/r1/events");
		const text = await sseReader(res).readUntil(() => false);
		expect(text).toContain('"fatal":true');
		expect(runner.listenerCount("r1")).toBe(0);
	});

	it("writes heartbeat comments at the configured interval", async () => {
		const { app, runStore } = setup({ heartbeatMs: 5 });
		await runStore.create(record("r1"));
		const res = await app.request("/api/runs/r1/events");
		const sse = sseReader(res);
		const text = await sse.readUntil((t) => t.includes(":"));
		expect(text).toMatch(/^: heartbeat/m);
		await sse.cancel();
	});

	it("unsubscribes when the client disconnects", async () => {
		const { app, runStore, runner } = setup();
		await runStore.create(record("r1"));
		const res = await app.request("/api/runs/r1/events");
		const reader = res.body?.getReader();
		await sleep(10);
		expect(runner.listenerCount("r1")).toBe(1);
		await reader?.cancel();
		await sleep(10);
		expect(runner.listenerCount("r1")).toBe(0);
	});

	it("→ 404 for an unknown run", async () => {
		const { app } = setup();
		expect((await app.request("/api/runs/nope/events")).status).toBe(404);
	});
});

describe("artifacts and report", () => {
	it("serves a png with image/png", async () => {
		const { app, runStore } = setup();
		await runStore.create(record("r1"));
		const rel = await runStore.saveScreenshot("r1", 3, "after", new Uint8Array([1, 2, 3]));
		expect(rel).toBe("steps/003/after.png");
		const res = await app.request(`/api/runs/r1/artifacts/${rel}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("rejects path traversal with 400", async () => {
		const { app, runStore } = setup();
		await runStore.create(record("r1"));
		// Literal and percent-encoded `..` segments are normalised away by the WHATWG URL parser
		// before Hono sees them (→ 404, never 200); backslashes reach the handler and are rejected.
		for (const path of ["../../etc/passwd", "steps/%2e%2e/%2e%2e/secret.txt"]) {
			const res = await app.request(`/api/runs/r1/artifacts/${path}`);
			expect([400, 404]).toContain(res.status);
		}
		const backslash = await app.request("/api/runs/r1/artifacts/steps%5C..%5Csecret.txt");
		expect(backslash.status).toBe(400);
		expect((await backslash.json()).error).toBe("bad_request");
	});

	it("missing artifact → 404; missing run → 404", async () => {
		const { app, runStore } = setup();
		await runStore.create(record("r1"));
		expect((await app.request("/api/runs/r1/artifacts/steps/001/nope.png")).status).toBe(404);
		expect((await app.request("/api/runs/zz/artifacts/steps/001/nope.png")).status).toBe(404);
	});

	it("GET /api/runs/:id/report serves report.html", async () => {
		const { app, runStore } = setup();
		await runStore.create(record("r1"));
		expect((await app.request("/api/runs/r1/report")).status).toBe(404);
		await runStore.saveReport("r1", {
			"report.html": "<html><body>87%</body></html>",
			"summary.json": "{}",
			"junit.xml": "<testsuite/>",
		});
		const res = await app.request("/api/runs/r1/report");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/^text\/html/);
		expect(await res.text()).toContain("87%");
	});
});

describe("static UI", () => {
	async function uiDir() {
		const dir = await mkdtemp(join(tmpdir(), "ae-ui-"));
		await writeFile(join(dir, "index.html"), "<!doctype html><title>agent-evaluator</title>");
		await mkdir(join(dir, "assets"));
		await writeFile(join(dir, "assets", "app.js"), "console.log(1)");
		return dir;
	}

	it("serves index.html at / and falls back to it for SPA routes", async () => {
		const { app } = setup({ uiDir: await uiDir() });
		const root = await app.request("/");
		expect(root.status).toBe(200);
		expect(root.headers.get("content-type")).toMatch(/^text\/html/);
		expect(await root.text()).toContain("agent-evaluator");
		const route = await app.request("/runs/abc");
		expect(route.status).toBe(200);
		expect(await route.text()).toContain("agent-evaluator");
	});

	it("serves assets with their mime type", async () => {
		const { app } = setup({ uiDir: await uiDir() });
		const res = await app.request("/assets/app.js");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/javascript/);
		expect(await res.text()).toBe("console.log(1)");
	});

	it("/api/nope → JSON 404 and never the SPA", async () => {
		const { app } = setup({ uiDir: await uiDir() });
		const res = await app.request("/api/nope");
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toMatch(/json/);
		expect(await res.json()).toEqual({ error: "not_found", message: expect.any(String) });
	});

	it("returns a JSON 404 when the UI is not built", async () => {
		const { app } = setup({ uiDir: join(tmpdir(), "ae-missing-ui-dir") });
		const res = await app.request("/");
		expect(res.status).toBe(404);
		expect((await res.json()).message).toMatch(/npm run build/);
	});
});

describe("error handling", () => {
	it("maps unexpected errors to a 500 without a stack trace or secret values", async () => {
		const deps = setup();
		deps.workspace.failWith = new Error(
			`request failed with key ${SECRET}\n    at Object.<anonymous>`,
		);
		const res = await deps.app.request("/api/personas");
		expect(res.status).toBe(500);
		const text = await res.text();
		expect(text).not.toContain(SECRET);
		expect(text).not.toContain("    at ");
		expect(JSON.parse(text)).toEqual({ error: "internal_error", message: expect.any(String) });
	});

	it("never leaks a configured secret in any provider/settings response", async () => {
		const { app, providers } = setup();
		providers.failures.set("openai", `401 for key ${SECRET}`);
		for (const path of ["/api/settings", "/api/providers", "/api/providers/openai/models"]) {
			const res = await app.request(path);
			expect(await res.text()).not.toContain(SECRET);
		}
	});
});
