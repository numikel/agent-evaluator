/**
 * agent-evaluator public API.
 *
 * Wiring a runner by hand (what the CLI does in `serve` / `run`):
 *
 * ```ts
 * const workspace = openWorkspace(root);
 * const settings = await workspace.loadSettings();
 * const runStore = openRunStore(join(root, settings.runs_dir));
 * const secrets = new EnvSecretsProvider();
 * const runner = createRunner({
 *   workspace,
 *   runStore,
 *   browserFactory: new PlaywrightSessionFactory(),
 *   modelFactory: new LangChainModelFactory({ secrets, registry: createProviderRegistry() }),
 * });
 * // ... runner.start({ scenario }), runner.wait(id), finally runner.close()
 * ```
 */

export { judgeRun } from "./agents/judge/index.js";
export type { JudgeDeps, JudgeInput } from "./agents/judge/types.js";
export { runSimulator } from "./agents/simulator/index.js";
export type { RunSimulatorOptions, SimulatorResult } from "./agents/simulator/run.js";
export { PlaywrightSessionFactory, resolveChromiumExecutable } from "./browser/index.js";
export type * from "./browser/types.js";
export {
	createProviderRegistry,
	EnvSecretsProvider,
	LangChainModelFactory,
	resolveSettings,
	runDoctor,
} from "./config/index.js";
export type * from "./config/types.js";
export { ProviderNotConfiguredError } from "./config/types.js";
export { renderHtml, renderReport } from "./report/index.js";
export type { ReportFiles, ReportInput } from "./report/types.js";
export type { RunnerDeps, RunnerHandle, RunnerLogger } from "./runner/index.js";
export { createRunner } from "./runner/index.js";
export type * from "./runner/types.js";
export { RunPreconditionError } from "./runner/types.js";
export * from "./schemas/index.js";
export type { RunningServer, ServerDeps, StartServerOptions } from "./server/index.js";
export { createApp, startServer } from "./server/index.js";
export { FakeBrowserSession, TINY_PNG } from "./testing/fake-browser-session.js";
export { ScriptedChatModel } from "./testing/scripted-chat-model.js";
export { openRunStore, openWorkspace } from "./workspace/index.js";
export type * from "./workspace/types.js";
export { WORKSPACE_DIRS, WORKSPACE_FILES } from "./workspace/types.js";

export const VERSION = "0.1.1";
