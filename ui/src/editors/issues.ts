/** Maps `POST /api/validate` issues (dotted zod paths) onto form fields. */

export type Issue = { path: string; message: string };

/** Message for `path` or the first issue nested under it (prefixed with the remaining path). */
export function issueFor(issues: readonly Issue[], path: string): string | undefined {
	const exact = issues.find((i) => i.path === path);
	if (exact) return exact.message;
	const nested = issues.find((i) => i.path.startsWith(`${path}.`));
	return nested ? `${nested.path.slice(path.length + 1)}: ${nested.message}` : undefined;
}

/** Splits issues into those a form field claims (`knownPaths` and their children) and the rest. */
export function groupIssues(
	issues: readonly Issue[],
	knownPaths: readonly string[],
): { mapped: Issue[]; unmapped: Issue[] } {
	const mapped: Issue[] = [];
	const unmapped: Issue[] = [];
	for (const issue of issues) {
		const known = knownPaths.some((p) => issue.path === p || issue.path.startsWith(`${p}.`));
		(known ? mapped : unmapped).push(issue);
	}
	return { mapped, unmapped };
}
