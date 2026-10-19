import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isNotFound(error)) return false;
		throw error;
	}
}

/** Reads a UTF-8 file, returning `undefined` when it does not exist. */
export async function readTextIfExists(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNotFound(error)) return undefined;
		throw error;
	}
}

/**
 * Writes `content` to a sibling temp file and renames it over `path`, so readers never observe a
 * partially written file. Creates parent directories as needed.
 */
export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
	try {
		await writeFile(tmp, content);
		await rename(tmp, path);
	} catch (error) {
		await rm(tmp, { force: true });
		throw error;
	}
}
