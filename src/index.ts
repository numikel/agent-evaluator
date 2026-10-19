/**
 * agent-evaluator public API.
 * P0 exposes schemas, contracts and test doubles; P10 adds `createRunner`, P1 `openWorkspace`, etc.
 */

export type * from "./browser/types.js";
export type * from "./config/types.js";
export type * from "./runner/types.js";
export { RunPreconditionError } from "./runner/types.js";
export * from "./schemas/index.js";
export { FakeBrowserSession, TINY_PNG } from "./testing/fake-browser-session.js";
export { ScriptedChatModel } from "./testing/scripted-chat-model.js";
export type * from "./workspace/types.js";
export { WORKSPACE_DIRS, WORKSPACE_FILES } from "./workspace/types.js";

export const VERSION = "0.1.0";
