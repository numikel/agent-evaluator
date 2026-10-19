import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, posix, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
	type EvaluatorConfig,
	EvaluatorConfigSchema,
	type Persona,
	PersonaSchema,
	parseOrThrow,
	type ResourceKind,
	type ResourceSummary,
	type Rubric,
	RubricSchema,
	type Scenario,
	ScenarioSchema,
	type Settings,
	SettingsSchema,
	SLUG_PATTERN,
	type Target,
	TargetSchema,
	ValidationError,
	type ValidationIssue,
	withBuiltinCriteria,
} from "../schemas/index.js";
import { splitFrontmatter } from "./frontmatter.js";
import { isNotFound, pathExists, readTextIfExists, writeFileAtomic } from "./fs-utils.js";
import { type ResolvedScenario, WORKSPACE_DIRS, WORKSPACE_FILES, type Workspace } from "./types.js";

type NamedKind = Exclude<ResourceKind, "evaluator" | "settings">;

const NAMED_KIND_DIRS: Record<NamedKind, string> = {
	persona: WORKSPACE_DIRS.personas,
	scenario: WORKSPACE_DIRS.scenarios,
	rubric: WORKSPACE_DIRS.rubrics,
	target: WORKSPACE_DIRS.targets,
};

const SINGLETON_FILES: Record<Exclude<ResourceKind, NamedKind>, string> = {
	evaluator: WORKSPACE_FILES.evaluator,
	settings: WORKSPACE_FILES.settings,
};

/** File name of each kind's template inside the package's `templates/` directory. */
export const TEMPLATE_FILES: Record<ResourceKind, string> = {
	persona: "PERSONA.md",
	scenario: "scenario.yaml",
	rubric: "rubric.yaml",
	target: "target.yaml",
	evaluator: "evaluator.yaml",
	settings: "agent-evaluator.yaml",
};

/** Directory created by `init` for run artifacts (matches the `runs_dir` settings default). */
const DEFAULT_RUNS_DIR = "runs";

const isNamedKind = (kind: ResourceKind): kind is NamedKind => kind in NAMED_KIND_DIRS;

const extensionOf = (kind: ResourceKind): string => (kind === "persona" ? ".md" : ".yaml");

/** Thrown when a workspace resource does not exist. */
export class ResourceNotFoundError extends Error {
	readonly kind: ResourceKind;
	readonly resourceName: string | undefined;
	readonly path: string;

	constructor(kind: ResourceKind, name: string | undefined, path: string) {
		const label = name === undefined ? kind : `${kind} '${name}'`;
		super(`${label} not found (expected ${path})`);
		this.name = "ResourceNotFoundError";
		this.kind = kind;
		this.resourceName = name;
		this.path = path;
	}
}

let packageRootPromise: Promise<string> | undefined;

/**
 * Locates the package root (the directory holding `package.json` and `templates/`) by walking up
 * from this module. Works from `src/` (tests, tsx) and from the bundled `dist/` alike.
 */
export async function packageRoot(): Promise<string> {
	packageRootPromise ??= (async () => {
		let dir = dirname(fileURLToPath(import.meta.url));
		for (;;) {
			const hasTemplates = await pathExists(join(dir, "templates"));
			const hasPackage = await pathExists(join(dir, "package.json"));
			if (hasTemplates && hasPackage) return dir;
			const parent = dirname(dir);
			if (parent === dir) {
				throw new Error("agent-evaluator package root with templates/ not found");
			}
			dir = parent;
		}
	})();
	return packageRootPromise;
}

function assertSlug(kind: ResourceKind, name: string | undefined): string {
	if (name === undefined || name === "") {
		throw new Error(`a name is required for resource kind '${kind}'`);
	}
	if (!SLUG_PATTERN.test(name)) {
		throw new Error(
			`invalid ${kind} name '${name}': must be a kebab-case slug (lowercase letters, digits, hyphens)`,
		);
	}
	return name;
}

function parseYamlDocument(content: string, source: string): unknown {
	try {
		return parseYaml(content) ?? {};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new ValidationError(source, [{ path: "", message: `invalid YAML: ${message}` }]);
	}
}

function parseResource(kind: ResourceKind, content: string, source: string): unknown {
	if (kind === "persona") {
		let split: ReturnType<typeof splitFrontmatter>;
		try {
			split = splitFrontmatter(content, source);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ValidationError(source, [{ path: "", message }]);
		}
		return parseOrThrow(
			PersonaSchema,
			{ frontmatter: split.frontmatter, body: split.body, path: source },
			source,
		);
	}
	const data = parseYamlDocument(content, source);
	switch (kind) {
		case "scenario":
			return parseOrThrow(ScenarioSchema, data, source);
		case "rubric":
			return parseOrThrow(RubricSchema, data, source);
		case "target":
			return parseOrThrow(TargetSchema, data, source);
		case "evaluator":
			return parseOrThrow(EvaluatorConfigSchema, data, source);
		case "settings":
			return parseOrThrow(SettingsSchema, data, source);
	}
}

/** Best-effort `description` extraction for listings; never throws. */
function describe(kind: NamedKind, content: string): string | undefined {
	try {
		const data = kind === "persona" ? splitFrontmatter(content).frontmatter : parseYaml(content);
		if (typeof data === "object" && data !== null && "description" in data) {
			const description = (data as { description?: unknown }).description;
			return typeof description === "string" ? description : undefined;
		}
	} catch {
		// unparsable files are still listed, just without a description
	}
	return undefined;
}

export class FsWorkspace implements Workspace {
	readonly root: string;

	constructor(root: string) {
		this.root = resolvePath(root);
	}

	/** Workspace-relative path (posix separators) of a resource file. */
	relativePath(kind: ResourceKind, name?: string): string {
		if (isNamedKind(kind)) {
			return posix.join(NAMED_KIND_DIRS[kind], `${assertSlug(kind, name)}${extensionOf(kind)}`);
		}
		return SINGLETON_FILES[kind];
	}

	private absolutePath(relativePath: string): string {
		return join(this.root, ...relativePath.split("/"));
	}

	async init(options?: { force?: boolean }): Promise<string[]> {
		const created: string[] = [];
		for (const dir of [...Object.values(WORKSPACE_DIRS), DEFAULT_RUNS_DIR]) {
			await mkdir(join(this.root, dir), { recursive: true });
		}
		for (const kind of Object.keys(TEMPLATE_FILES) as ResourceKind[]) {
			const content = await this.template(kind);
			const name = isNamedKind(kind) ? templateName(kind, content) : undefined;
			const relativePath = this.relativePath(kind, name);
			const absolutePath = this.absolutePath(relativePath);
			if (!options?.force && (await pathExists(absolutePath))) continue;
			await writeFileAtomic(absolutePath, content);
			created.push(relativePath);
		}
		return created;
	}

	async list(kind: NamedKind): Promise<ResourceSummary[]> {
		const dir = join(this.root, NAMED_KIND_DIRS[kind]);
		const extension = extensionOf(kind);
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch (error) {
			if (isNotFound(error)) return [];
			throw error;
		}
		const summaries: ResourceSummary[] = [];
		for (const file of entries.filter((f) => f.endsWith(extension)).sort()) {
			const name = file.slice(0, -extension.length);
			if (!SLUG_PATTERN.test(name)) continue;
			const relativePath = this.relativePath(kind, name);
			const absolutePath = this.absolutePath(relativePath);
			const [info, content] = await Promise.all([
				stat(absolutePath),
				readTextIfExists(absolutePath),
			]);
			if (!info.isFile() || content === undefined) continue;
			const description = describe(kind, content);
			summaries.push({
				name,
				path: relativePath,
				updated_at: info.mtime.toISOString(),
				...(description !== undefined ? { description } : {}),
			});
		}
		return summaries;
	}

	private async loadParsed(kind: ResourceKind, name?: string): Promise<unknown> {
		const relativePath = this.relativePath(kind, name);
		const content = await readTextIfExists(this.absolutePath(relativePath));
		if (content === undefined) throw new ResourceNotFoundError(kind, name, relativePath);
		return parseResource(kind, content, relativePath);
	}

	loadPersona(name: string): Promise<Persona> {
		return this.loadParsed("persona", name) as Promise<Persona>;
	}

	loadScenario(name: string): Promise<Scenario> {
		return this.loadParsed("scenario", name) as Promise<Scenario>;
	}

	loadRubric(name: string): Promise<Rubric> {
		return this.loadParsed("rubric", name) as Promise<Rubric>;
	}

	loadTarget(name: string): Promise<Target> {
		return this.loadParsed("target", name) as Promise<Target>;
	}

	loadEvaluator(): Promise<EvaluatorConfig> {
		return this.loadParsed("evaluator") as Promise<EvaluatorConfig>;
	}

	/** Missing `agent-evaluator.yaml` yields the schema defaults (every setting has one). */
	async loadSettings(): Promise<Settings> {
		try {
			return (await this.loadParsed("settings")) as Settings;
		} catch (error) {
			if (error instanceof ResourceNotFoundError) return SettingsSchema.parse({});
			throw error;
		}
	}

	async readRaw(kind: ResourceKind, name?: string): Promise<string> {
		const relativePath = this.relativePath(kind, name);
		const content = await readTextIfExists(this.absolutePath(relativePath));
		if (content === undefined) throw new ResourceNotFoundError(kind, name, relativePath);
		return content;
	}

	async writeRaw(kind: ResourceKind, content: string, name?: string): Promise<void> {
		const relativePath = this.relativePath(kind, name);
		parseResource(kind, content, relativePath);
		await writeFileAtomic(this.absolutePath(relativePath), content);
	}

	async remove(kind: NamedKind, name: string): Promise<void> {
		const relativePath = this.relativePath(kind, name);
		const absolutePath = this.absolutePath(relativePath);
		if (!(await pathExists(absolutePath))) {
			throw new ResourceNotFoundError(kind, name, relativePath);
		}
		await rm(absolutePath);
	}

	async validateRaw(
		kind: ResourceKind,
		content: string,
	): Promise<{ ok: true } | { ok: false; issues: ValidationIssue[] }> {
		try {
			parseResource(kind, content, `<${kind}>`);
			return { ok: true };
		} catch (error) {
			if (error instanceof ValidationError) return { ok: false, issues: error.issues };
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, issues: [{ path: "", message }] };
		}
	}

	async resolve(scenarioName: string, overrides?: { target?: string }): Promise<ResolvedScenario> {
		const scenario = await this.loadScenario(scenarioName);
		const referenced = <T>(promise: Promise<T>, kind: ResourceKind, name: string): Promise<T> =>
			promise.catch((error: unknown) => {
				if (error instanceof ResourceNotFoundError) {
					throw new Error(
						`${kind} '${name}' referenced by scenario '${scenario.name}' not found (expected ${error.path})`,
					);
				}
				throw error;
			});

		const targetName = overrides?.target ?? scenario.target;
		const [persona, target, evaluator, settings] = await Promise.all([
			referenced(this.loadPersona(scenario.persona), "persona", scenario.persona),
			referenced(this.loadTarget(targetName), "target", targetName),
			this.loadEvaluator(),
			this.loadSettings(),
		]);

		const rubricName = scenario.rubric ?? evaluator.default_rubric;
		if (rubricName === undefined) {
			throw new Error(
				`no rubric for scenario '${scenario.name}': set 'rubric' in the scenario or 'default_rubric' in ${WORKSPACE_FILES.evaluator}`,
			);
		}
		const rubric = withBuiltinCriteria(
			await referenced(this.loadRubric(rubricName), "rubric", rubricName),
		);

		return { scenario, persona, target, rubric, evaluator, settings };
	}

	async template(kind: ResourceKind): Promise<string> {
		const file = TEMPLATE_FILES[kind];
		const content = await readTextIfExists(join(await packageRoot(), "templates", file));
		if (content === undefined)
			throw new Error(`template for '${kind}' not found (templates/${file})`);
		return content;
	}
}

/** The `name` declared inside a shipped template, used as the file name on `init`. */
function templateName(kind: NamedKind, content: string): string {
	const parsed = parseResource(kind, content, `templates/${TEMPLATE_FILES[kind]}`) as
		| Persona
		| { name: string };
	return "frontmatter" in parsed ? parsed.frontmatter.name : parsed.name;
}
