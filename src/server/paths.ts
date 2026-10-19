import { existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Directory holding the nearest `package.json` above this module. Works both from `src/` (tsx,
 * vitest) and from the bundled `dist/` output, so shipped assets (`dist/ui`, `templates/`) can be
 * located without knowing the bundle layout.
 */
export function packageRoot(from: string = import.meta.url): string {
	let dir = dirname(fileURLToPath(from));
	for (let i = 0; i < 10; i++) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`agent-evaluator: cannot locate package.json from ${from}`);
}

/** Built SPA directory (`dist/ui`). */
export function defaultUiDir(): string {
	return join(packageRoot(), "dist", "ui");
}

/** Shipped templates directory (`templates/`). */
export function templatesDir(): string {
	return join(packageRoot(), "templates");
}

/**
 * Rejects absolute paths, `..` segments, backslashes and NUL bytes in a run-relative artifact
 * path; returns the normalised posix path.
 */
export function guardRelativePath(relativePath: string): string {
	if (
		relativePath.includes("\\") ||
		relativePath.includes("\0") ||
		posix.isAbsolute(relativePath)
	) {
		throw new Error(`invalid artifact path '${relativePath}'`);
	}
	const normalised = posix.normalize(relativePath);
	if (normalised === ".." || normalised.startsWith("../") || normalised === ".") {
		throw new Error(`invalid artifact path '${relativePath}'`);
	}
	return normalised;
}
