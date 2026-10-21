import { type Command, InvalidArgumentError } from "commander";
import { type DemoMode, isDemoMode } from "../../../fixtures/demo-chatbot/brain.js";
import { DEFAULT_DEMO_PORT } from "../../../fixtures/demo-chatbot/server.js";
import type { CliDeps } from "../deps.js";
import { parsePort } from "./serve.js";

export const DEMO_MODES = ["normal", "slow", "offtopic", "broken", "noattach"] as const;

function parseMode(value: string): DemoMode {
	if (!isDemoMode(value)) throw new InvalidArgumentError(`must be one of ${DEMO_MODES.join(", ")}`);
	return value;
}

/**
 * `agent-evaluator demo`: starts the built-in demo chatbot the template target points at, so the
 * quick start works from an npm install without cloning the repository.
 */
export function registerDemo(program: Command, deps: CliDeps): void {
	program
		.command("demo")
		.description("Start the built-in demo chatbot the template target points at (Ctrl+C stops it)")
		.option("-p, --port <port>", `port to listen on (default: ${DEFAULT_DEMO_PORT})`, parsePort)
		.option("-m, --mode <mode>", `default behaviour: ${DEMO_MODES.join(" | ")}`, parseMode)
		.action(async (options: { port?: number; mode?: DemoMode }) => {
			const demo = await deps.startDemo(
				options.port ?? DEFAULT_DEMO_PORT,
				options.mode ? { defaultMode: options.mode } : {},
			);
			deps.onShutdown(() => demo.close());
			deps.stdout(
				`Demo chatbot listening on ${demo.url}\n` +
					`  mode:   ${options.mode ?? "normal"} (per page: ${demo.url}/?mode=slow|offtopic|broken|noattach)\n` +
					`  target: targets/demo-chatbot.yaml from \`agent-evaluator init\` points at http://localhost:${DEFAULT_DEMO_PORT}\n` +
					"Press Ctrl+C to stop.\n",
			);
		});
}
