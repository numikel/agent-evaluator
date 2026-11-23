#!/usr/bin/env node
/**
 * Prints the CHANGELOG.md section of one version, without its `## [x.y.z]` heading, for the
 * GitHub Release body: `node scripts/release-notes.mjs 0.1.4 [CHANGELOG.md]`. Exits 1 when the
 * changelog has no section for that version, so a release never goes out with empty notes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} changelog Keep a Changelog text.
 * @param {string} version `x.y.z`, with or without a leading `v`.
 * @returns {string} The section body, trimmed.
 */
export function releaseNotes(changelog, version) {
	const wanted = version.replace(/^v/, "");
	const lines = changelog.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`## [${wanted}]`));
	if (start === -1) throw new Error(`CHANGELOG.md has no section for ${wanted}`);
	const rest = lines.slice(start + 1);
	// The section ends at the next version heading or at the link reference definitions.
	const end = rest.findIndex((line) => line.startsWith("## [") || /^\[[^\]]+\]: /.test(line));
	return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [version, file = "CHANGELOG.md"] = process.argv.slice(2);
	if (!version) {
		process.stderr.write("usage: release-notes.mjs <version> [CHANGELOG.md]\n");
		process.exit(2);
	}
	try {
		process.stdout.write(`${releaseNotes(readFileSync(file, "utf8"), version)}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	}
}
