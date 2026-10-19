/**
 * Test harness for the CLI (reused by the E2E phase): builds the program with captured
 * stdout/stderr, an empty environment and no colours, and returns the exit code the binary would
 * have used instead of exiting the process.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { minimalPdf } from "../agents/judge/test-fixtures.js";
import { createRunner } from "../runner/index.js";
import { FakeSessionFactory, ScriptedModelFactory } from "../runner/testing.js";
import { FakeBrowserSession } from "../testing/fake-browser-session.js";
import { ScriptedChatModel, type ScriptedTurn } from "../testing/scripted-chat-model.js";
import type { CliDeps } from "./deps.js";
import { runCli } from "./main.js";

export type CliHarness = {
	/** Parses `args` (without the `node` and script entries) and resolves with the exit code. */
	run(...args: string[]): Promise<number>;
	stdout(): string;
	stderr(): string;
	/** Clears the captured output. */
	reset(): void;
};

export function createCliHarness(overrides: Partial<CliDeps> = {}): CliHarness {
	const out: string[] = [];
	const err: string[] = [];
	const deps: Partial<CliDeps> = {
		env: {},
		cwd: "/nowhere",
		color: false,
		stdout: (text) => {
			out.push(text);
		},
		stderr: (text) => {
			err.push(text);
		},
		onShutdown: () => undefined,
		openUrl: async () => undefined,
		...overrides,
	};
	return {
		run: (...args) => runCli(args, deps),
		stdout: () => out.join(""),
		stderr: () => err.join(""),
		reset: () => {
			out.length = 0;
			err.length = 0;
		},
	};
}

const BOT_REPLY =
	"Here is your invoice for September 2026 (customer 4471). Click Download to save it.";

const call = (name: string, args: Record<string, unknown> = {}): ScriptedTurn => ({
	toolCalls: [{ name, args }],
});

type JudgeOutput = { score: number; pass: boolean; reason: string; evidence: unknown[] };
const verdict = (score: number, pass: boolean, reason = "scripted"): JudgeOutput => ({
	score,
	pass,
	reason,
	evidence: [],
});

/** A one-page PDF in a fresh temp dir, in the shape `FakeBrowserSession` serves as a download. */
function pdfDownload(): { filename: string; path: string; mime: string; bytes: number } {
	const dir = mkdtempSync(join(tmpdir(), "ae-cli-dl-"));
	const filename = "invoice-september-2026.pdf";
	const path = join(dir, filename);
	const pdf = minimalPdf("Invoice INV-2026-09 for September 2026, customer 4471, total 120.00 EUR");
	writeFileSync(path, pdf);
	return { filename, path, mime: "application/pdf", bytes: pdf.length };
}

/**
 * A `createRunner` dependency backed by the fakes: the simulated user sends one message,
 * downloads the PDF and ends the conversation; the judge passes (or fails) the goal criterion.
 * Mirrors the runner's own test script, so it works against a workspace made by `init`.
 */
export function fakeRunnerFactory(
	options: { goalReached?: boolean } = {},
): CliDeps["createRunner"] {
	const goalReached = options.goalReached ?? true;
	return ({ workspace, runStore, logger }) =>
		createRunner({
			workspace,
			runStore,
			browserFactory: new FakeSessionFactory({
				make: () => new FakeBrowserSession({ replies: [BOT_REPLY], downloads: [pdfDownload()] }),
			}),
			modelFactory: new ScriptedModelFactory({
				simulator: () =>
					new ScriptedChatModel({
						script: [
							call("snapshot"),
							call("send_message", { text: "need my invoice for september, customer 4471" }),
							call("download", { ref: "e5" }),
							call("end_conversation", { reason: "goal_reached", summary: "Got it." }),
						],
						strict: true,
					}),
				judge: () =>
					new ScriptedChatModel({
						script: [],
						structured: [
							{ steps: [2] },
							verdict(goalReached ? 1 : 0, goalReached, goalReached ? "Confirmed." : "No PDF."),
							verdict(4, true),
							verdict(1, true),
							verdict(5, true),
						],
					}),
			}),
			...(logger ? { logger } : {}),
		});
}
