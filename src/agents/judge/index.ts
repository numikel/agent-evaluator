/**
 * Judge agent (P7): turns the run artifacts into a `Verdict`.
 *
 * Order: extract downloaded files → deterministic criteria → evidence selection (≤ `max_images`)
 * → LLM criteria, sequentially, each through `withStructuredOutput` → `computeOutcome`.
 * File extraction runs before the deterministic pass because `contains`/`regex` with `in: files`
 * and `file.contains` read the extracted text.
 */
import {
	type CriterionResult,
	computeOutcome,
	type DownloadArtifact,
	GOAL_REACHED_CRITERION_ID,
	type Verdict,
	withBuiltinCriteria,
} from "../../schemas/index.js";
import { evaluateDeterministic, isDeterministic } from "./deterministic.js";
import { selectEvidence } from "./evidence.js";
import { extractText } from "./extractors.js";
import { loadScreenshots, scoreLlmCriterion } from "./llm.js";
import { buildJudgePrompt } from "./prompt.js";
import type { ExtractedFile, JudgeDeps, JudgeInput } from "./types.js";

export * from "./deterministic.js";
export * from "./evidence.js";
export * from "./extractors.js";
export * from "./llm.js";
export * from "./prompt.js";
export * from "./types.js";

/** Reads every download through `readFile` and extracts its text. Never throws. */
export async function extractDownloads(
	downloads: DownloadArtifact[],
	readFile: JudgeInput["readFile"],
): Promise<ExtractedFile[]> {
	const out: ExtractedFile[] = [];
	for (const download of downloads) {
		let bytes: Uint8Array;
		try {
			bytes = await readFile(download.path);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			out.push({ ...download, text: "", error: `could not read file: ${message}` });
			continue;
		}
		const result = await extractText({ path: download.path, mime: download.mime, bytes });
		const file: ExtractedFile = { ...download, text: result.text };
		if (result.mime) file.mime = result.mime;
		if (result.error) file.error = result.error;
		if (result.text) file.text_excerpt = result.text.slice(0, 2000);
		out.push(file);
	}
	return out;
}

const percent = (n: number) => `${Math.round(n * 100)}%`;

function summarise(
	verdict: Pick<Verdict, "status" | "score" | "pass_threshold" | "goal_reached" | "criteria">,
	requiredFailed: string[],
	evidenceNote: string | undefined,
): string {
	const passed = verdict.criteria.filter((c) => c.pass).length;
	const parts = [
		`${verdict.status}: score ${percent(verdict.score)} (threshold ${percent(verdict.pass_threshold)}).`,
		`Goal reached: ${verdict.goal_reached ? "yes" : "no"}.`,
		`${passed}/${verdict.criteria.length} criteria passed.`,
	];
	if (requiredFailed.length > 0)
		parts.push(`Required criteria failed: ${requiredFailed.join(", ")}.`);
	if (evidenceNote) parts.push(evidenceNote);
	return parts.join(" ");
}

/** Scores a finished run against its rubric and returns the verdict. Judge-model errors propagate. */
export async function judgeRun(input: JudgeInput, deps: JudgeDeps): Promise<Verdict> {
	const { run, resolved } = input;
	const rubric = withBuiltinCriteria(resolved.rubric);
	const now = deps.now ?? (() => new Date());
	const results = new Map<string, CriterionResult>();
	const emit = async (result: CriterionResult) => {
		results.set(result.id, result);
		await deps.onCriterion?.(result);
	};

	// 1. Downloaded files → text (deterministic file criteria and the prompt both need it).
	const files = await extractDownloads(input.downloads, input.readFile);

	// 2. Deterministic criteria, in rubric order.
	const ctx = { transcript: input.transcript, files, console: input.console };
	for (const criterion of rubric.criteria) {
		if (isDeterministic(criterion)) await emit(evaluateDeterministic(criterion, ctx));
	}

	// 3. Evidence: pick ≤ max_images screenshots, then load the bytes once for every LLM call.
	const selection = await selectEvidence({
		steps: input.steps,
		transcript: input.transcript,
		maxImages: resolved.evaluator.max_images,
		strategy: resolved.evaluator.evidence_selection,
		selectorModel: deps.selectorModel ?? deps.judgeModel,
	});
	const screenshots = await loadScreenshots(selection.steps, input.readFile);

	// 4. LLM criteria, sequentially, in rubric order.
	for (const criterion of rubric.criteria) {
		if (criterion.type !== "llm") continue;
		const prompt = buildJudgePrompt({
			run,
			resolved: { ...resolved, rubric },
			criterion,
			transcript: input.transcript,
			files,
			console: input.console,
			screenshots: screenshots.steps,
		});
		await emit(
			await scoreLlmCriterion({
				criterion,
				prompt,
				images: screenshots.images,
				model: deps.judgeModel,
			}),
		);
	}

	// 5. Aggregate (decision D7) and assemble the verdict in rubric order.
	const criteria = rubric.criteria
		.map((c) => results.get(c.id))
		.filter((r): r is CriterionResult => !!r);
	const goal = results.get(GOAL_REACHED_CRITERION_ID);
	const goalReached = goal?.pass ?? false;
	const outcome = computeOutcome({
		criteria,
		goalReached,
		passThreshold: rubric.pass_threshold,
	});
	const requiredFailed = criteria.filter((c) => c.required && !c.pass).map((c) => c.id);
	const evidenceNote = selection.fallback
		? `Evidence screenshots were selected uniformly (${selection.fallback}).`
		: undefined;
	const base = {
		status: outcome.status,
		score: outcome.score,
		pass_threshold: rubric.pass_threshold,
		goal_reached: goalReached,
		criteria,
	};
	const verdict: Verdict = {
		runId: run.id,
		...base,
		turns_used: run.turns_used,
		max_turns: run.max_turns,
		summary: summarise(base, requiredFailed, evidenceNote),
		judged_at: now().toISOString(),
		judge_model: run.models.judge,
		evidence_screenshots: screenshots.steps.flatMap((s) => (s.screenshot ? [s.screenshot] : [])),
	};
	if (goal) verdict.goal_assessment = goal.reason;
	return verdict;
}
