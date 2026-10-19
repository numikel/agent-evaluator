import { z } from "zod";
import { SlugSchema } from "./common.js";
import { EvaluatorConfigSchema } from "./evaluator.js";
import { PersonaFrontmatterSchema } from "./persona.js";
import { RubricSchema } from "./rubric.js";
import { RunRecordSchema, RunSummarySchema, VerdictSchema } from "./run.js";
import { ScenarioSchema } from "./scenario.js";
import { SettingsSchema } from "./settings.js";
import { TargetSchema } from "./target.js";

/**
 * REST DTOs shared by the Hono server (`src/server`) and the SPA (`ui/`).
 * Routes (all under `/api`):
 *   GET    /health
 *   GET    /workspace                      → WorkspaceOverview
 *   GET    /personas | /scenarios | /rubrics | /targets        → list of ResourceSummary
 *   GET    /personas/:name                 → PersonaDocument  (others → their schema)
 *   PUT    /personas/:name                 ← PersonaDocument  (validated; 422 on ValidationErrorBody)
 *   DELETE /personas/:name
 *   POST   /validate                       ← { kind, content } → ValidateResponse
 *   GET    /templates/:kind                → raw template text (download)
 *   GET    /evaluator  | PUT /evaluator    → EvaluatorConfig
 *   GET    /settings   | PUT /settings     → SettingsResponse (providers = presence only)
 *   GET    /providers                      → ProviderStatus[] (only providers whose env key is set)
 *   GET    /providers/:id/models           → ProviderModelsResponse (fetched from the provider API, cached)
 *   GET    /runs                           → RunSummary[]
 *   POST   /runs                           ← StartRunRequest → StartRunResponse
 *   GET    /runs/:id                       → RunDetail
 *   POST   /runs/:id/cancel
 *   GET    /runs/:id/events                → SSE stream of RunEvent (data: JSON)
 *   GET    /runs/:id/artifacts/*           → static files from the run dir
 *   GET    /runs/:id/report                → report.html
 */

export const ResourceKindSchema = z.enum([
	"persona",
	"scenario",
	"rubric",
	"target",
	"evaluator",
	"settings",
]);
export type ResourceKind = z.output<typeof ResourceKindSchema>;

export const ResourceSummarySchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	path: z.string(),
	updated_at: z.string().optional(),
});
export type ResourceSummary = z.output<typeof ResourceSummarySchema>;

export const PersonaDocumentSchema = z.object({
	frontmatter: PersonaFrontmatterSchema,
	body: z.string(),
});
export type PersonaDocument = z.output<typeof PersonaDocumentSchema>;

export const WorkspaceOverviewSchema = z.object({
	root: z.string(),
	personas: z.array(ResourceSummarySchema),
	scenarios: z.array(ResourceSummarySchema),
	rubrics: z.array(ResourceSummarySchema),
	targets: z.array(ResourceSummarySchema),
	has_evaluator: z.boolean(),
	has_settings: z.boolean(),
});
export type WorkspaceOverview = z.output<typeof WorkspaceOverviewSchema>;

export const ValidationErrorBodySchema = z.object({
	error: z.literal("validation_error"),
	source: z.string().optional(),
	issues: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type ValidationErrorBody = z.output<typeof ValidationErrorBodySchema>;

export const ApiErrorBodySchema = z.object({
	error: z.string(),
	message: z.string(),
});
export type ApiErrorBody = z.output<typeof ApiErrorBodySchema>;

export const ValidateRequestSchema = z.object({
	kind: ResourceKindSchema,
	/** Raw file content (Markdown for persona, YAML otherwise). */
	content: z.string(),
});
export const ValidateResponseSchema = z.union([
	z.object({ ok: z.literal(true) }),
	z.object({ ok: z.literal(false), issues: ValidationErrorBodySchema.shape.issues }),
]);
export type ValidateResponse = z.output<typeof ValidateResponseSchema>;

export const ProviderStatusSchema = z.object({
	id: z.string(),
	label: z.string(),
	/** Name of the env var that configures it (value is never exposed). */
	env: z.string(),
	configured: z.boolean(),
});
export type ProviderStatus = z.output<typeof ProviderStatusSchema>;

/** One selectable model, as reported by the provider's model-listing API (fields vary by provider). */
export const ModelInfoSchema = z.object({
	provider: z.string(),
	id: z.string(),
	label: z.string(),
	/** Full `provider:model` reference to store in settings. */
	ref: z.string(),
	context_window: z.number().int().positive().optional(),
	max_output_tokens: z.number().int().positive().optional(),
	supports_reasoning: z.boolean().optional(),
	supports_images: z.boolean().optional(),
	supports_tools: z.boolean().optional(),
});
export type ModelInfo = z.output<typeof ModelInfoSchema>;

export const ProviderModelsResponseSchema = z.object({
	provider: z.string(),
	models: z.array(ModelInfoSchema),
	fetched_at: z.string(),
	/** `api` when listed live, `fallback` when the provider has no listing endpoint or the call failed. */
	source: z.enum(["api", "fallback"]),
	error: z.string().optional(),
});
export type ProviderModelsResponse = z.output<typeof ProviderModelsResponseSchema>;

export const SettingsResponseSchema = z.object({
	settings: SettingsSchema,
	providers: z.array(ProviderStatusSchema),
	browser_installed: z.boolean(),
});
export type SettingsResponse = z.output<typeof SettingsResponseSchema>;

export const StartRunRequestSchema = z.object({
	scenario: SlugSchema,
	/** Overrides scenario.target when set. */
	target: SlugSchema.optional(),
	repeat: z.number().int().positive().max(50).optional(),
	headless: z.boolean().optional(),
});
export type StartRunRequest = z.output<typeof StartRunRequestSchema>;

export const StartRunResponseSchema = z.object({ runIds: z.array(z.string()) });
export type StartRunResponse = z.output<typeof StartRunResponseSchema>;

export const RunDetailSchema = z.object({
	run: RunRecordSchema,
	verdict: VerdictSchema.optional(),
	has_report: z.boolean(),
});
export type RunDetail = z.output<typeof RunDetailSchema>;

export const RunListResponseSchema = z.array(RunSummarySchema);

// Re-exported resource schemas so the UI imports one module.
export { EvaluatorConfigSchema, RubricSchema, ScenarioSchema, SettingsSchema, TargetSchema };
