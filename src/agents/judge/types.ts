/**
 * Judge agent contract (P7). The judge never touches the filesystem directly: run artifacts are
 * passed in as parsed records and binary files (screenshots, downloads) are loaded through the
 * injected `readFile`, so the runner (P10) can back it with `RunStore.readFile` and tests with memory.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type {
	ConsoleEntry,
	CriterionResult,
	DownloadArtifact,
	RunRecord,
	Step,
	TranscriptEntry,
} from "../../schemas/index.js";
import type { ResolvedScenario } from "../../workspace/types.js";

export type JudgeInput = {
	run: RunRecord;
	/** Scenario with persona, target, rubric (built-in criteria applied), evaluator and settings. */
	resolved: ResolvedScenario;
	steps: Step[];
	transcript: TranscriptEntry[];
	downloads: DownloadArtifact[];
	console: ConsoleEntry[];
	/** Reads a file by its run-relative path (e.g. `steps/003/after.png`, `downloads/x.pdf`). */
	readFile(relativePath: string): Promise<Uint8Array>;
};

export type JudgeDeps = {
	/** Scores every `llm` criterion through `withStructuredOutput`. */
	judgeModel: BaseChatModel;
	/** Picks key screenshots when `evaluator.evidence_selection` is `llm`; defaults to `judgeModel`. */
	selectorModel?: BaseChatModel;
	/** Clock for `judged_at`; defaults to `() => new Date()`. */
	now?: () => Date;
	/**
	 * Called as each criterion is scored, for live UIs: deterministic criteria first, then LLM
	 * criteria, each group in rubric order. `Verdict.criteria` is always in rubric order.
	 */
	onCriterion?: (result: CriterionResult) => void | Promise<void>;
};

/** A downloaded file with its extracted text (see `extractors.ts`). */
export type ExtractedFile = DownloadArtifact & {
	text: string;
	/** Extraction failure, if any; the file still counts as downloaded. */
	error?: string;
};

export type EvidenceStrategy = "uniform" | "llm";

export type EvidenceSelection = {
	/** Steps whose primary screenshot is attached to the judge prompt, in step order. */
	steps: Step[];
	/** Strategy actually used (`uniform` after a selector failure). */
	strategy: EvidenceStrategy;
	/** Why the selector fell back to `uniform`, when it did. */
	fallback?: string;
};
