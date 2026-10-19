import { z } from "zod";
import { HttpUrlSchema, SlugSchema } from "./common.js";

export const TargetAuthSchema = z.object({
	/** Path to a Playwright storageState JSON (cookies + localStorage) captured beforehand. */
	storage_state: z.string().optional(),
	/** Natural-language login instructions the simulator follows before the conversation. */
	login_steps: z.string().optional(),
	/** Names of environment variables holding credentials (values are never stored). */
	credentials_env: z
		.object({ username: z.string().optional(), password: z.string().optional() })
		.optional(),
});

export const TargetTimeoutsSchema = z.object({
	/** Max time to wait for a bot reply to start and settle. */
	response_ms: z.number().int().positive().default(60_000),
	/** Reply is considered complete when the chat region is unchanged for this long. */
	stable_ms: z.number().int().positive().default(1500),
	navigation_ms: z.number().int().positive().default(30_000),
	/** Interim evidence screenshot cadence while waiting for a reply. */
	capture_interval_ms: z.number().int().positive().default(2000),
});

/** `targets/<name>.yaml` — the chatbot under test. Everything but `url` is optional help for the agent. */
export const TargetSchema = z.object({
	name: SlugSchema,
	description: z.string().optional(),
	url: HttpUrlSchema,
	auth: TargetAuthSchema.optional(),
	/** Natural-language hints, e.g. "the chat opens after clicking the bubble bottom-right". */
	hints: z.array(z.string().min(1)).default([]),
	timeouts: TargetTimeoutsSchema.prefault({}),
	viewport: z
		.object({ width: z.number().int().positive(), height: z.number().int().positive() })
		.default({ width: 1280, height: 800 }),
	vision: z.boolean().default(false),
	headless: z.boolean().default(true),
});
export type Target = z.output<typeof TargetSchema>;
