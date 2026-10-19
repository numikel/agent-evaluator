/**
 * Typed fetch wrapper for the `/api` routes documented in `src/schemas/api.ts`.
 * Generic verbs (`api.get/put/post/del`) plus `endpoints`, a map of ready-typed calls.
 */
import type {
	ApiErrorBody,
	PersonaDocument,
	ProviderModelsResponse,
	ProviderStatus,
	ResourceKind,
	ResourceSummary,
	RunDetail,
	SettingsResponse,
	StartRunRequest,
	StartRunResponse,
	ValidateResponse,
	ValidationErrorBody,
	WorkspaceOverview,
} from "@schemas/api";
import type { EvaluatorConfig } from "@schemas/evaluator";
import type { Rubric } from "@schemas/rubric";
import type { RunSummary } from "@schemas/run";
import type { Scenario } from "@schemas/scenario";
import type { Settings } from "@schemas/settings";
import type { Target } from "@schemas/target";

export type ValidationIssue = ValidationErrorBody["issues"][number];

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly body: unknown;

	constructor(status: number, code: string, message: string, body?: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

/** A 422 whose body is a {@link ValidationErrorBody}. */
export class ApiValidationError extends ApiError {
	readonly issues: ValidationIssue[];
	readonly source: string | undefined;

	constructor(status: number, body: ValidationErrorBody) {
		const lines = body.issues.map((i) => `${i.path || "<root>"}: ${i.message}`).join("; ");
		super(
			status,
			body.error,
			`Validation failed${body.source ? ` in ${body.source}` : ""}: ${lines}`,
			body,
		);
		this.name = "ApiValidationError";
		this.issues = body.issues;
		this.source = body.source;
	}
}

type Method = "GET" | "PUT" | "POST" | "DELETE";

/** `fetch` needs absolute URLs outside the browser; in the browser this is a no-op. */
export function resolveUrl(path: string): string {
	if (/^https?:\/\//.test(path)) return path;
	const base = globalThis.location?.href ?? "http://localhost/";
	return new URL(path, base).toString();
}

function isValidationBody(value: unknown): value is ValidationErrorBody {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { error?: unknown }).error === "validation_error" &&
		Array.isArray((value as { issues?: unknown }).issues)
	);
}

function isErrorBody(value: unknown): value is ApiErrorBody {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { error?: unknown }).error === "string" &&
		typeof (value as { message?: unknown }).message === "string"
	);
}

async function readBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (text.length === 0) return undefined;
	const type = response.headers.get("content-type") ?? "";
	if (!type.includes("json")) return text;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

type Body = { json: unknown } | { text: string; contentType: string };

async function request<T>(method: Method, path: string, body?: Body): Promise<T> {
	const init: RequestInit = { method, headers: { Accept: "application/json" } };
	if (body !== undefined) {
		const contentType = "json" in body ? "application/json" : body.contentType;
		init.headers = { ...init.headers, "Content-Type": contentType };
		init.body = "json" in body ? JSON.stringify(body.json) : body.text;
	}
	const response = await fetch(resolveUrl(path), init);
	const payload = await readBody(response);
	if (response.ok) return payload as T;
	if (response.status === 422 && isValidationBody(payload)) {
		throw new ApiValidationError(response.status, payload);
	}
	if (isErrorBody(payload)) {
		throw new ApiError(response.status, payload.error, payload.message, payload);
	}
	const message =
		typeof payload === "string" && payload.length > 0
			? payload
			: response.statusText || `HTTP ${response.status}`;
	throw new ApiError(response.status, "http_error", message, payload);
}

export const TEXT_PLAIN = "text/plain; charset=utf-8";

export const api = {
	get: <T>(path: string) => request<T>("GET", path),
	put: <T>(path: string, body: unknown) => request<T>("PUT", path, { json: body }),
	/** PUT raw file text; the server validates it and keeps comments intact. */
	putText: <T>(path: string, text: string, contentType: string = TEXT_PLAIN) =>
		request<T>("PUT", path, { text, contentType }),
	post: <T>(path: string, body?: unknown) =>
		request<T>("POST", path, body === undefined ? undefined : { json: body }),
	del: (path: string) => request<undefined>("DELETE", path),
};

export type Collection = "personas" | "scenarios" | "rubrics" | "targets";
export type ResourceDocument = {
	personas: PersonaDocument;
	scenarios: Scenario;
	rubrics: Rubric;
	targets: Target;
};

const seg = encodeURIComponent;

/** Route-typed calls built on {@link api}; the DTO types come from `@schemas/api`. */
export const endpoints = {
	health: () => api.get<{ ok: boolean }>("/api/health"),
	workspace: () => api.get<WorkspaceOverview>("/api/workspace"),
	list: (collection: Collection) => api.get<ResourceSummary[]>(`/api/${collection}`),
	resource: <C extends Collection>(collection: C, name: string) =>
		api.get<ResourceDocument[C]>(`/api/${collection}/${seg(name)}`),
	saveResource: <C extends Collection>(collection: C, name: string, doc: ResourceDocument[C]) =>
		api.put<ResourceDocument[C]>(`/api/${collection}/${seg(name)}`, doc),
	/** Saves the raw file (Markdown for personas, YAML otherwise); 204 on success, 422 on issues. */
	saveResourceText: (collection: Collection, name: string, text: string) =>
		api.putText<undefined>(`/api/${collection}/${seg(name)}`, text),
	deleteResource: (collection: Collection, name: string) =>
		api.del(`/api/${collection}/${seg(name)}`),
	validate: (kind: ResourceKind, content: string) =>
		api.post<ValidateResponse>("/api/validate", { kind, content }),
	templateUrl: (kind: ResourceKind) => `/api/templates/${kind}`,
	/** Template file text (the same bytes the download link serves). */
	template: (kind: ResourceKind) => api.get<string>(`/api/templates/${kind}`),
	evaluator: () => api.get<EvaluatorConfig>("/api/evaluator"),
	saveEvaluator: (config: EvaluatorConfig) => api.put<EvaluatorConfig>("/api/evaluator", config),
	saveEvaluatorText: (text: string) => api.putText<EvaluatorConfig>("/api/evaluator", text),
	settings: () => api.get<SettingsResponse>("/api/settings"),
	saveSettings: (settings: Settings) => api.put<SettingsResponse>("/api/settings", settings),
	providers: () => api.get<ProviderStatus[]>("/api/providers"),
	providerModels: (id: string, options?: { refresh?: boolean }) =>
		api.get<ProviderModelsResponse>(
			`/api/providers/${seg(id)}/models${options?.refresh ? "?refresh=1" : ""}`,
		),
	runs: () => api.get<RunSummary[]>("/api/runs"),
	startRun: (body: StartRunRequest) => api.post<StartRunResponse>("/api/runs", body),
	run: (id: string) => api.get<RunDetail>(`/api/runs/${seg(id)}`),
	cancelRun: (id: string) => api.post<{ ok: boolean }>(`/api/runs/${seg(id)}/cancel`),
	artifactUrl: (id: string, path: string) => `/api/runs/${seg(id)}/artifacts/${path}`,
	reportUrl: (id: string) => `/api/runs/${seg(id)}/report`,
};
