import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageRoot } from "../src/server/paths.js";
import { releaseNotes } from "./release-notes.mjs";

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

See \`changelog.d/\`.

## [1.2.0] — 2026-11-30

Summary line.

### Fixed
- One fix.

## [1.1.0] — 2026-11-01

### Added
- Older entry.

[Unreleased]: https://example.com/compare/v1.2.0...HEAD
[1.2.0]: https://example.com/compare/v1.1.0...v1.2.0
`;

describe("releaseNotes", () => {
	it("returns one version's section without its heading or the next one", () => {
		expect(releaseNotes(CHANGELOG, "1.2.0")).toBe("Summary line.\n\n### Fixed\n- One fix.");
	});

	it("stops at the link references after the last section and accepts a v prefix", () => {
		expect(releaseNotes(CHANGELOG, "v1.1.0")).toBe("### Added\n- Older entry.");
	});

	it("throws for a version the changelog does not have", () => {
		expect(() => releaseNotes(CHANGELOG, "1.0.0")).toThrow(/1\.0\.0/);
		expect(() => releaseNotes(CHANGELOG, "1.2")).toThrow(/1\.2/);
	});

	it("prints the section of the real CHANGELOG.md for the release workflow", () => {
		const root = packageRoot();
		const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
		const out = execFileSync(
			process.execPath,
			[join(root, "scripts", "release-notes.mjs"), version],
			{
				cwd: root,
				encoding: "utf8",
			},
		);
		expect(out.trim().length).toBeGreaterThan(0);
		expect(out).not.toContain(`## [${version}]`);
		expect(out).toBe(
			`${releaseNotes(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version)}\n`,
		);
	});
});
