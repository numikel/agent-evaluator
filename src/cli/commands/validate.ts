import type { Command } from "commander";
import { type ResourceKind, ValidationError, type ValidationIssue } from "../../schemas/index.js";
import { WORKSPACE_FILES } from "../../workspace/index.js";
import type { Workspace } from "../../workspace/types.js";
import { workspaceRoot } from "../context.js";
import type { CliDeps } from "../deps.js";
import { CHECK, CliExitError, CROSS, createPalette, plural } from "../output.js";

const NAMED_KINDS = ["persona", "scenario", "rubric", "target"] as const;

type FileResult = { path: string; issues: ValidationIssue[] };

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Both workspace implementations signal a missing resource with ENOENT or "not found". */
function isNotFound(error: unknown): boolean {
	const code = (error as { code?: unknown } | undefined)?.code;
	return code === "ENOENT" || /not found/i.test(errorMessage(error));
}

/** Top-level `name:` of a YAML document or persona frontmatter, without a full parse. */
function declaredName(content: string): string | undefined {
	const match = /^name:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m.exec(content);
	return match?.[1];
}

async function checkFile(
	workspace: Workspace,
	kind: ResourceKind,
	name: string | undefined,
	path: string,
): Promise<FileResult> {
	const content = await workspace.readRaw(kind, name);
	const result = await workspace.validateRaw(kind, content);
	const issues: ValidationIssue[] = result.ok ? [] : [...result.issues];
	if (result.ok && name !== undefined) {
		const declared = declaredName(content);
		if (declared !== undefined && declared !== name) {
			issues.push({
				path: "name",
				message: `'${declared}' does not match the file name '${name}'`,
			});
		}
	}
	return { path, issues };
}

/** Validates every file, then the cross-references of each well-formed scenario. */
export async function validateWorkspace(workspace: Workspace): Promise<FileResult[]> {
	const results: FileResult[] = [];

	for (const kind of ["evaluator", "settings"] as const) {
		const path = WORKSPACE_FILES[kind];
		try {
			results.push(await checkFile(workspace, kind, undefined, path));
		} catch (error) {
			if (!isNotFound(error)) throw error;
			if (kind === "evaluator") {
				results.push({
					path,
					issues: [{ path: "", message: "not found (run `agent-evaluator init` to create it)" }],
				});
			}
		}
	}

	const scenarios: string[] = [];
	for (const kind of NAMED_KINDS) {
		for (const summary of await workspace.list(kind)) {
			const result = await checkFile(workspace, kind, summary.name, summary.path);
			results.push(result);
			if (kind === "scenario" && result.issues.length === 0) scenarios.push(summary.name);
		}
	}

	for (const name of scenarios) {
		const result = results.find((r) => r.path.endsWith(`/${name}.yaml`));
		if (!result) continue;
		try {
			await workspace.resolve(name);
		} catch (error) {
			// A referenced file that failed its own validation is already listed above.
			if (error instanceof ValidationError) continue;
			result.issues.push({ path: "", message: errorMessage(error) });
		}
	}
	return results;
}

export function registerValidate(program: Command, deps: CliDeps): void {
	program
		.command("validate")
		.description("Validate every workspace file and the references between them")
		.option("-w, --workspace <dir>", "workspace directory (default: current directory)")
		.action(async (options: { workspace?: string }) => {
			const palette = createPalette(deps.color);
			const root = workspaceRoot(deps, options.workspace);
			const results = await validateWorkspace(deps.openWorkspace(root));

			deps.stdout(`Validating workspace ${root}\n`);
			let issueCount = 0;
			for (const { path, issues } of results) {
				if (issues.length === 0) {
					deps.stdout(`${palette.green(CHECK)} ${path}\n`);
					continue;
				}
				issueCount += issues.length;
				deps.stdout(`${palette.red(CROSS)} ${path}\n`);
				for (const issue of issues) {
					deps.stdout(`    ${path}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}\n`);
				}
			}
			const summary =
				issueCount === 0
					? `${plural(results.length, "file")} checked, no issues`
					: `${plural(results.length, "file")} checked, ${plural(issueCount, "issue")}`;
			deps.stdout(`\n${summary}\n`);
			if (issueCount > 0) throw new CliExitError(`${plural(issueCount, "issue")} found`);
		});
}
