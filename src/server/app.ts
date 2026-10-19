/**
 * Hono application factory: REST API under `/api` (routes documented in `src/schemas/api.ts`),
 * SSE run events, run artifacts and the built SPA. Everything is injected through the frozen
 * contracts so the app can be exercised with the in-memory fakes from `./testing.ts`.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getMimeType, mimes } from "hono/utils/mime";
import pino, { type Logger } from "pino";
import type { z } from "zod";
import type { ProviderRegistry, SecretsProvider } from "../config/types.js";
import { type Runner, RunPreconditionError } from "../runner/types.js";
import {
	type ApiErrorBody,
	EvaluatorConfigSchema,
	type ModelInfo,
	PersonaDocumentSchema,
	type ProviderModelsResponse,
	parseWith,
	type ResourceKind,
	ResourceKindSchema,
	RubricSchema,
	type RunDetail,
	type RunEvent,
	ScenarioSchema,
	type Settings,
	type SettingsResponse,
	SettingsSchema,
	StartRunRequestSchema,
	TargetSchema,
	ValidateRequestSchema,
	type ValidateResponse,
	ValidationError,
	type ValidationErrorBody,
	type WorkspaceOverview,
} from "../schemas/index.js";
import type { RunStore, Workspace } from "../workspace/types.js";
import { joinFrontmatter, TEMPLATE_FILENAMES, toYaml } from "./documents.js";
import { defaultUiDir, guardRelativePath } from "./paths.js";

export type ServerDeps = {
	workspace: Workspace;
	runStore: RunStore;
	runner: Runner;
	providers: ProviderRegistry;
	secrets: SecretsProvider;
	/** Defaults to `workspace.loadSettings()`. */
	settingsLoader?: () => Promise<Settings>;
	/** Defaults to checking Playwright's Chromium executable on disk. */
	browserInstalled?: () => Promise<boolean>;
	/** Built SPA directory; defaults to `<package>/dist/ui`. */
	uiDir?: string;
	/** Reported by `GET /api/health`. */
	version?: string;
	/** SSE heartbeat comment interval (default 15 s). */
	heartbeatMs?: number;
	logger?: Logger;
};

const DEFAULT_HEARTBEAT_MS = 15_000;
const CANCELLABLE = new Set(["PENDING", "RUNNING", "JUDGING"]);
const COLLECTIONS = {
	personas: "persona",
	scenarios: "scenario",
	rubrics: "rubric",
	targets: "target",
} as const;
type CollectionKind = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
const YAML_SCHEMAS = {
	scenario: ScenarioSchema,
	rubric: RubricSchema,
	target: TargetSchema,
} as const;
const EXTRA_MIMES = {
	...mimes,
	jsonl: "application/x-ndjson",
	yaml: "application/yaml",
	yml: "application/yaml",
	xml: "application/xml",
	md: "text/markdown; charset=utf-8",
};

/** HTTP error with a machine-readable `error` code for the JSON body. */
export class ApiError extends HTTPException {
	readonly code: string;
	constructor(status: ContentfulStatusCode, code: string, message: string) {
		super(status, { message });
		this.code = code;
	}
}

type Validate = <S extends z.ZodType>(schema: S, input: unknown, source?: string) => z.output<S>;
const validate: Validate = (schema, input, source) => {
	const result = parseWith(schema, input, source);
	if (!result.ok) throw result.error;
	return result.data;
};

async function readJson(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		throw new ValidationError(undefined, [{ path: "", message: "body must be valid JSON" }]);
	}
}

function isJson(c: Context): boolean {
	return (c.req.header("content-type") ?? "").toLowerCase().includes("json");
}

function isNotFound(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	return (
		code === "ENOENT" || error.name === "NotFoundError" || /\bnot found\b/i.test(error.message)
	);
}

function isValidationError(error: unknown): error is ValidationError {
	return (
		error instanceof ValidationError ||
		(error instanceof Error &&
			error.name === "ValidationError" &&
			Array.isArray((error as { issues?: unknown }).issues))
	);
}

function asBody(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return bytes.buffer instanceof ArrayBuffer
		? (bytes as Uint8Array<ArrayBuffer>)
		: new Uint8Array(bytes);
}

function mimeFor(path: string): string {
	return getMimeType(path, EXTRA_MIMES) ?? "application/octet-stream";
}

function isTerminal(event: RunEvent): boolean {
	return event.type === "done" || (event.type === "error" && event.fatal);
}

async function defaultBrowserInstalled(): Promise<boolean> {
	try {
		const { chromium } = await import("playwright");
		return existsSync(chromium.executablePath());
	} catch {
		return false;
	}
}

export function createApp(deps: ServerDeps): Hono {
	const {
		workspace,
		runStore,
		runner,
		providers,
		secrets,
		settingsLoader = () => workspace.loadSettings(),
		browserInstalled = defaultBrowserInstalled,
		uiDir = defaultUiDir(),
		version = "0.0.0",
		heartbeatMs = DEFAULT_HEARTBEAT_MS,
		logger = pino({ name: "agent-evaluator", level: process.env.LOG_LEVEL ?? "info" }),
	} = deps;

	/** Replaces every configured secret value with a placeholder (defence in depth, ADR-0002). */
	const redact = (text: string): string => {
		let out = text;
		for (const definition of providers.all()) {
			const value = secrets.get(definition.env);
			if (value && value.length >= 4) out = out.split(value).join("[redacted]");
		}
		return out;
	};

	const app = new Hono();
	const api = new Hono();

	app.use("*", async (c, next) => {
		const started = Date.now();
		await next();
		logger.debug(
			{ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started },
			"request",
		);
	});

	app.notFound((c) => {
		const body: ApiErrorBody = {
			error: "not_found",
			message: `No route for ${c.req.method} ${c.req.path}`,
		};
		return c.json(body, 404);
	});

	app.onError((error, c) => {
		if (isValidationError(error)) {
			const body: ValidationErrorBody = { error: "validation_error", issues: error.issues };
			if (error.source) body.source = error.source;
			return c.json(body, 422);
		}
		if (error instanceof RunPreconditionError) {
			const body: ValidationErrorBody = {
				error: "validation_error",
				source: "run",
				issues: [{ path: "", message: redact(error.message) }],
			};
			return c.json(body, 422);
		}
		if (error instanceof ApiError) {
			return c.json({ error: error.code, message: redact(error.message) }, error.status);
		}
		if (error instanceof HTTPException) {
			return c.json({ error: "http_error", message: redact(error.message) }, error.status);
		}
		if (isNotFound(error)) {
			return c.json({ error: "not_found", message: redact(error.message) }, 404);
		}
		logger.error({ err: error, path: c.req.path }, "unhandled error");
		return c.json({ error: "internal_error", message: "Internal server error" }, 500);
	});

	// --- health & workspace --------------------------------------------------------------------

	api.get("/health", (c) => c.json({ ok: true, version }));

	api.get("/workspace", async (c) => {
		const exists = (kind: ResourceKind) =>
			workspace.readRaw(kind).then(
				() => true,
				() => false,
			);
		const [personas, scenarios, rubrics, targets, hasEvaluator, hasSettings] = await Promise.all([
			workspace.list("persona"),
			workspace.list("scenario"),
			workspace.list("rubric"),
			workspace.list("target"),
			exists("evaluator"),
			exists("settings"),
		]);
		const body: WorkspaceOverview = {
			root: workspace.root,
			personas,
			scenarios,
			rubrics,
			targets,
			has_evaluator: hasEvaluator,
			has_settings: hasSettings,
		};
		return c.json(body);
	});

	// --- resource collections ------------------------------------------------------------------

	const loadOne = async (kind: CollectionKind, name: string): Promise<unknown> => {
		switch (kind) {
			case "persona": {
				const { frontmatter, body } = await workspace.loadPersona(name);
				return { frontmatter, body };
			}
			case "scenario":
				return workspace.loadScenario(name);
			case "rubric":
				return workspace.loadRubric(name);
			case "target":
				return workspace.loadTarget(name);
		}
	};

	/** Validates a JSON document for `kind` and returns the raw file content to persist. */
	const serialise = (kind: CollectionKind, name: string, input: unknown): string => {
		if (kind === "persona") {
			const document = validate(PersonaDocumentSchema, input);
			if (document.frontmatter.name !== name) {
				throw new ValidationError(undefined, [
					{ path: "frontmatter.name", message: `must match the URL name '${name}'` },
				]);
			}
			const raw = input as { frontmatter: unknown; body: string };
			return joinFrontmatter(raw.frontmatter, document.body);
		}
		const parsed = validate(YAML_SCHEMAS[kind], input);
		if (parsed.name !== name) {
			throw new ValidationError(undefined, [
				{ path: "name", message: `must match the URL name '${name}'` },
			]);
		}
		return toYaml(input);
	};

	for (const [collection, kind] of Object.entries(COLLECTIONS) as [string, CollectionKind][]) {
		api.get(`/${collection}`, async (c) => c.json(await workspace.list(kind)));
		api.get(`/${collection}/:name`, async (c) => c.json(await loadOne(kind, c.req.param("name"))));
		api.put(`/${collection}/:name`, async (c) => {
			const name = c.req.param("name");
			const raw = isJson(c) ? serialise(kind, name, await readJson(c)) : await c.req.text();
			await workspace.writeRaw(kind, raw, name);
			return c.body(null, 204);
		});
		api.delete(`/${collection}/:name`, async (c) => {
			await workspace.remove(kind, c.req.param("name"));
			return c.body(null, 204);
		});
	}

	api.post("/validate", async (c) => {
		const request = validate(ValidateRequestSchema, await readJson(c));
		const result: ValidateResponse = await workspace.validateRaw(request.kind, request.content);
		return c.json(result);
	});

	api.get("/templates/:kind", async (c) => {
		const kind = ResourceKindSchema.safeParse(c.req.param("kind"));
		if (!kind.success) throw new ApiError(404, "not_found", "unknown template kind");
		const text = await workspace.template(kind.data);
		return c.body(text, 200, {
			"Content-Type": "text/plain; charset=utf-8",
			"Content-Disposition": `attachment; filename="${TEMPLATE_FILENAMES[kind.data]}"`,
		});
	});

	// --- evaluator & settings ------------------------------------------------------------------

	api.get("/evaluator", async (c) => c.json(await workspace.loadEvaluator()));
	api.put("/evaluator", async (c) => {
		let raw: string;
		if (isJson(c)) {
			const input = await readJson(c);
			validate(EvaluatorConfigSchema, input);
			raw = toYaml(input);
		} else {
			raw = await c.req.text();
		}
		await workspace.writeRaw("evaluator", raw);
		return c.json(await workspace.loadEvaluator());
	});

	const settingsResponse = async (settings: Settings): Promise<SettingsResponse> => ({
		settings,
		providers: providers.status(secrets),
		browser_installed: await browserInstalled(),
	});

	api.get("/settings", async (c) => c.json(await settingsResponse(await settingsLoader())));
	api.put("/settings", async (c) => {
		let settings: Settings;
		if (isJson(c)) {
			const input = await readJson(c);
			settings = validate(SettingsSchema, input);
			await workspace.writeRaw("settings", toYaml(input));
		} else {
			await workspace.writeRaw("settings", await c.req.text());
			settings = await workspace.loadSettings();
		}
		return c.json(await settingsResponse(settings));
	});

	// --- providers -----------------------------------------------------------------------------

	api.get("/providers", (c) => c.json(providers.status(secrets).filter((p) => p.configured)));

	api.get("/providers/:id/models", async (c) => {
		const id = c.req.param("id");
		const definition = providers.all().find((p) => p.id === id);
		if (!definition || !secrets.has(definition.env)) {
			throw new ApiError(404, "not_found", `provider '${id}' is unknown or not configured`);
		}
		const refresh = ["1", "true"].includes(c.req.query("refresh") ?? "");
		const result = await providers.listModels(id, secrets, { refresh });
		const body: ProviderModelsResponse = {
			provider: id,
			models: result.models as ModelInfo[],
			fetched_at: new Date().toISOString(),
			source: result.source,
		};
		if (result.error !== undefined) body.error = redact(result.error);
		return c.json(body);
	});

	// --- runs ----------------------------------------------------------------------------------

	api.get("/runs", async (c) => c.json(await runStore.list()));

	api.post("/runs", async (c) => {
		const request = validate(StartRunRequestSchema, await readJson(c));
		return c.json(await runner.start(request), 202);
	});

	api.get("/runs/:id", async (c) => {
		const id = c.req.param("id");
		const run = await runStore.readRecord(id);
		const [verdict, hasReport] = await Promise.all([
			runStore.readVerdict(id),
			runStore.readFile(id, "report.html").then(
				() => true,
				() => false,
			),
		]);
		const body: RunDetail = { run, has_report: hasReport };
		if (verdict) body.verdict = verdict;
		return c.json(body);
	});

	api.post("/runs/:id/cancel", async (c) => {
		const id = c.req.param("id");
		const run = await runStore.readRecord(id);
		if (!CANCELLABLE.has(run.status)) {
			throw new ApiError(409, "not_cancellable", `run '${id}' is already ${run.status}`);
		}
		await runner.cancel(id);
		return c.body(null, 204);
	});

	api.get("/runs/:id/events", async (c) => {
		const id = c.req.param("id");
		await runStore.readRecord(id);
		return streamSSE(c, async (stream) => {
			let seq = 0;
			let finished = false;
			let chain = Promise.resolve();
			let finish: () => void = () => undefined;
			const closed = new Promise<void>((resolveClosed) => {
				finish = () => {
					finished = true;
					resolveClosed();
				};
			});
			const send = (data: string) => {
				chain = chain.then(() => stream.writeSSE({ data, id: String(++seq) }));
				return chain;
			};

			// Subscribe before replaying so nothing emitted during the replay is lost.
			const buffered: RunEvent[] = [];
			let replaying = true;
			const unsubscribe = runner.subscribe(id, (event) => {
				if (finished) return;
				if (replaying) {
					buffered.push(event);
					return;
				}
				void send(JSON.stringify(event));
				if (isTerminal(event)) void chain.then(finish);
			});
			stream.onAbort(finish);

			let history: string[] = [];
			try {
				const bytes = await runStore.readFile(id, "events.jsonl");
				history = new TextDecoder()
					.decode(bytes)
					.split(/\r?\n/)
					.filter((line) => line.trim() !== "");
			} catch {
				// No history yet: the run has not emitted anything.
			}
			const seen = new Set(history);
			for (const line of history) {
				await send(line);
				try {
					if (isTerminal(JSON.parse(line) as RunEvent)) finish();
				} catch {
					// Malformed line: forwarded as-is, the client's schema parse will drop it.
				}
			}
			replaying = false;
			for (const event of buffered) {
				if (finished) break;
				const line = JSON.stringify(event);
				if (seen.has(line)) continue;
				await send(line);
				if (isTerminal(event)) finish();
			}

			const heartbeat = setInterval(() => {
				chain = chain.then(async () => {
					await stream.write(`: heartbeat ${new Date().toISOString()}\n\n`);
				});
			}, heartbeatMs);
			try {
				await closed;
				await chain;
			} finally {
				clearInterval(heartbeat);
				unsubscribe();
			}
		});
	});

	api.get("/runs/:id/artifacts/*", async (c) => {
		const id = c.req.param("id");
		const marker = "/artifacts/";
		const relative = c.req.path.slice(c.req.path.indexOf(marker) + marker.length);
		let safe: string;
		try {
			safe = guardRelativePath(relative);
			runStore.artifactPath(id, safe);
		} catch {
			throw new ApiError(400, "bad_request", "invalid artifact path");
		}
		const bytes = await runStore.readFile(id, safe);
		return c.body(asBody(bytes), 200, { "Content-Type": mimeFor(safe) });
	});

	api.get("/runs/:id/report", async (c) => {
		const bytes = await runStore.readFile(c.req.param("id"), "report.html");
		return c.body(asBody(bytes), 200, { "Content-Type": "text/html; charset=utf-8" });
	});

	app.route("/api", api);

	// --- static SPA ----------------------------------------------------------------------------

	const uiRoot = resolve(uiDir);
	const serveFile = async (path: string, c: Context, cacheControl: string) => {
		const bytes = await readFile(path);
		return c.body(asBody(bytes), 200, {
			"Content-Type": mimeFor(path),
			"Cache-Control": cacheControl,
		});
	};
	const resolveStatic = async (pathname: string): Promise<string | undefined> => {
		if (/(?:^|\/)\.\.(?:\/|$)|\\|\0/.test(pathname)) return undefined;
		const target = resolve(uiRoot, `.${pathname}`);
		if (target !== uiRoot && !target.startsWith(uiRoot + sep)) return undefined;
		try {
			const info = await stat(target);
			if (info.isFile()) return target;
			if (info.isDirectory()) {
				const index = resolve(target, "index.html");
				if ((await stat(index)).isFile()) return index;
			}
		} catch {
			// fall through to the SPA fallback
		}
		return undefined;
	};

	app.get("*", async (c) => {
		if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.notFound();
		const file = await resolveStatic(c.req.path);
		if (file) {
			const immutable = c.req.path.startsWith("/assets/");
			return serveFile(file, c, immutable ? "public, max-age=31536000, immutable" : "no-cache");
		}
		const index = resolve(uiRoot, "index.html");
		if (existsSync(index)) return serveFile(index, c, "no-cache");
		return c.json(
			{ error: "not_found", message: "UI is not built: run `npm run build` to create dist/ui" },
			404,
		);
	});

	return app;
}
