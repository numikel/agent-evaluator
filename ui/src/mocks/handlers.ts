/**
 * msw handlers covering every route listed in `src/schemas/api.ts`. They are stateless: PUT
 * validates and echoes the document, POST /runs mints an id. Tests that need other behaviour
 * override a route with `server.use(...)`.
 */
import type {
	ApiErrorBody,
	ResourceKind,
	SettingsResponse,
	StartRunResponse,
	ValidateResponse,
	ValidationErrorBody,
} from "@schemas/api";
import {
	EvaluatorConfigSchema,
	PersonaDocumentSchema,
	RubricSchema,
	ScenarioSchema,
	SettingsSchema,
	StartRunRequestSchema,
	TargetSchema,
	ValidateRequestSchema,
} from "@schemas/api";
import { parseWith } from "@schemas/common";
import { PersonaFrontmatterSchema } from "@schemas/persona";
import { HttpResponse, type HttpResponseInit, http, type JsonBodyType } from "msw";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import * as fx from "./fixtures.js";

const API = "*/api";

/* Resolvers return plain `Response` so msw keeps its default body type across mixed branches. */
const json = (body: JsonBodyType, init?: HttpResponseInit): Response =>
	HttpResponse.json(body, init);
const text = (body: string, init?: HttpResponseInit): Response => HttpResponse.text(body, init);

function notFound(message: string): Response {
	const body: ApiErrorBody = { error: "not_found", message };
	return json(body, { status: 404 });
}

function validationError(issues: ValidationErrorBody["issues"], source?: string): Response {
	const body: ValidationErrorBody = { error: "validation_error", issues };
	if (source) body.source = source;
	return json(body, { status: 422 });
}

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

/** Validates `request`'s JSON body with `schema`; responds 422 on failure, echoes the parsed value otherwise. */
async function validatedPut(
	request: Request,
	schema: z.ZodType,
	source: string,
): Promise<Response> {
	const body = await readJson(request);
	const result = parseWith(schema, body, source);
	if (!result.ok) return validationError(result.error.issues, source);
	return json(result.data as JsonBodyType);
}

type Collection = "personas" | "scenarios" | "rubrics" | "targets";

const documents: Record<Collection, { name: string; doc: JsonBodyType; schema: z.ZodType }> = {
	personas: { name: fx.persona.frontmatter.name, doc: fx.persona, schema: PersonaDocumentSchema },
	scenarios: { name: fx.scenario.name, doc: fx.scenario, schema: ScenarioSchema },
	rubrics: { name: fx.rubric.name, doc: fx.rubric, schema: RubricSchema },
	targets: { name: fx.target.name, doc: fx.target, schema: TargetSchema },
};

function resourceHandlers(collection: Collection) {
	const { name, doc, schema } = documents[collection];
	const singular = collection.slice(0, -1);
	return [
		http.get(`${API}/${collection}`, () => json(fx.summaries[collection])),
		http.get(`${API}/${collection}/:name`, ({ params }) =>
			params.name === name ? json(doc) : notFound(`${singular} "${String(params.name)}" not found`),
		),
		http.put(`${API}/${collection}/:name`, ({ request, params }) =>
			validatedPut(request, schema, `${collection}/${String(params.name)}`),
		),
		http.delete(`${API}/${collection}/:name`, () => new HttpResponse(null, { status: 204 })),
	];
}

const kindSchemas: Record<ResourceKind, z.ZodType> = {
	persona: PersonaFrontmatterSchema,
	scenario: ScenarioSchema,
	rubric: RubricSchema,
	target: TargetSchema,
	evaluator: EvaluatorConfigSchema,
	settings: SettingsSchema,
};

function validateContent(kind: ResourceKind, content: string): ValidateResponse {
	let parsed: unknown;
	try {
		parsed = kind === "persona" ? fx.splitFrontmatter(content).frontmatter : parseYaml(content);
	} catch (error) {
		return { ok: false, issues: [{ path: "", message: (error as Error).message }] };
	}
	const result = parseWith(kindSchemas[kind], parsed);
	return result.ok ? { ok: true } : { ok: false, issues: result.error.issues };
}

const settingsResponse = (settings: typeof fx.settings): SettingsResponse => ({
	settings,
	providers: fx.providers,
	browser_installed: true,
});

let runCounter = 0;

export const handlers = [
	http.get(`${API}/health`, () => json({ ok: true })),
	http.get(`${API}/workspace`, () => json(fx.workspace)),

	...resourceHandlers("personas"),
	...resourceHandlers("scenarios"),
	...resourceHandlers("rubrics"),
	...resourceHandlers("targets"),

	http.post(`${API}/validate`, async ({ request }) => {
		const result = parseWith(ValidateRequestSchema, await readJson(request));
		if (!result.ok) return validationError(result.error.issues);
		return json(validateContent(result.data.kind, result.data.content));
	}),

	http.get(`${API}/templates/:kind`, ({ params }) => {
		const kind = String(params.kind) as ResourceKind;
		const template = fx.templates[kind];
		return template === undefined
			? notFound(`template "${kind}" not found`)
			: text(template, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
	}),

	http.get(`${API}/evaluator`, () => json(fx.evaluator)),
	http.put(`${API}/evaluator`, ({ request }) =>
		validatedPut(request, EvaluatorConfigSchema, "evaluator.yaml"),
	),

	http.get(`${API}/settings`, () => json(settingsResponse(fx.settings))),
	http.put(`${API}/settings`, async ({ request }) => {
		const result = parseWith(SettingsSchema, await readJson(request), "agent-evaluator.yaml");
		if (!result.ok) return validationError(result.error.issues, "agent-evaluator.yaml");
		return json(settingsResponse(result.data));
	}),

	http.get(`${API}/providers`, () => json(fx.providers)),
	http.get(`${API}/providers/:id/models`, ({ params }) => {
		const id = String(params.id);
		return fx.providers.some((p) => p.id === id)
			? json(fx.providerModels(id))
			: notFound(`provider "${id}" is not configured`);
	}),

	http.get(`${API}/runs`, () => json(fx.runs.map(fx.toSummary))),
	http.post(`${API}/runs`, async ({ request }) => {
		const result = parseWith(StartRunRequestSchema, await readJson(request));
		if (!result.ok) return validationError(result.error.issues);
		const repeat = result.data.repeat ?? 1;
		runCounter += 1;
		const stamp = `20261019-1200${String(runCounter).padStart(2, "0")}`;
		const runIds = Array.from(
			{ length: repeat },
			(_, i) => `${stamp}-${result.data.scenario}-${i + 1}`,
		);
		const response: StartRunResponse = { runIds };
		return json(response, { status: 202 });
	}),
	http.get(`${API}/runs/:id`, ({ params }) => {
		const detail = fx.runDetail(String(params.id));
		return detail ? json(detail) : notFound(`run "${String(params.id)}" not found`);
	}),
	http.post(`${API}/runs/:id/cancel`, ({ params }) =>
		fx.runs.some((r) => r.id === params.id)
			? json({ ok: true }, { status: 202 })
			: notFound(`run "${String(params.id)}" not found`),
	),
	http.get(`${API}/runs/:id/events`, ({ params }) => {
		const body = fx
			.runEvents(String(params.id))
			.map((event) => `data: ${JSON.stringify(event)}\n\n`)
			.join("");
		return text(body, {
			headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
		});
	}),
	http.get(`${API}/runs/:id/artifacts/*`, ({ request }) => {
		const path = new URL(request.url).pathname.split("/artifacts/")[1] ?? "";
		return text(`mock artifact ${path}`);
	}),
	http.get(`${API}/runs/:id/report`, ({ params }) =>
		params.id === fx.PASSED_RUN_ID || params.id === fx.FAILED_RUN_ID
			? text(fx.reportHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } })
			: notFound("report not available"),
	),
];
