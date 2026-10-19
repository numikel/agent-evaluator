/**
 * Test doubles for the runner (reused by the CLI and E2E phases): a counting
 * `BrowserSessionFactory` over `FakeBrowserSession`, a `ModelFactory` that hands out fresh
 * `ScriptedChatModel`s per role, and a temp workspace initialised from the shipped templates.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type {
	BrowserSession,
	BrowserSessionFactory,
	BrowserSessionOptions,
	WaitForReplyOptions,
	WaitForReplyResult,
} from "../browser/types.js";
import type { CreateModelOptions, ModelFactory } from "../config/types.js";
import type { ModelRole, Settings } from "../schemas/index.js";
import {
	FakeBrowserSession,
	type FakeBrowserSessionOptions,
} from "../testing/fake-browser-session.js";
import type { ScriptedChatModel } from "../testing/scripted-chat-model.js";
import { openRunStore, openWorkspace } from "../workspace/index.js";
import type { RunStore, Workspace } from "../workspace/types.js";

export type FakeSessionFactoryOptions = {
	/** Builds the session for the n-th `create` call (0-based). Defaults to a plain fake. */
	make?: (index: number, options: BrowserSessionOptions) => FakeBrowserSession;
};

/** Counts live sessions so concurrency tests can assert the semaphore. */
export class FakeSessionFactory implements BrowserSessionFactory {
	readonly sessions: FakeBrowserSession[] = [];
	readonly options: BrowserSessionOptions[] = [];
	alive = 0;
	maxAlive = 0;
	closed = false;
	private readonly make: NonNullable<FakeSessionFactoryOptions["make"]>;

	constructor(options: FakeSessionFactoryOptions = {}) {
		this.make = options.make ?? (() => new FakeBrowserSession());
	}

	async create(options: BrowserSessionOptions): Promise<BrowserSession> {
		const session = this.make(this.sessions.length, options);
		this.sessions.push(session);
		this.options.push(options);
		this.alive += 1;
		this.maxAlive = Math.max(this.maxAlive, this.alive);
		const originalClose = session.close.bind(session);
		let released = false;
		session.close = async () => {
			await originalClose();
			if (!released) {
				released = true;
				this.alive -= 1;
			}
		};
		return session;
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

export type SlowFakeSessionOptions = FakeBrowserSessionOptions & {
	/** Delay of `waitForReplyStable`; `Infinity` blocks until the session is closed. */
	replyDelayMs?: number;
	/** Makes `open` reject with this message. */
	failOpen?: string;
};

/**
 * `FakeBrowserSession` whose reply wait takes time (to make runs overlap) or blocks until the
 * session is closed (to test cancellation), and whose `open` can be scripted to fail.
 */
export class SlowFakeSession extends FakeBrowserSession {
	private readonly replyDelayMs: number;
	private readonly failOpen: string | undefined;
	private readonly closeListeners: Array<() => void> = [];

	constructor(options: SlowFakeSessionOptions = {}) {
		const { replyDelayMs, failOpen, ...rest } = options;
		super(rest);
		this.replyDelayMs = replyDelayMs ?? 0;
		this.failOpen = failOpen;
	}

	override async open(url: string): Promise<void> {
		if (this.failOpen !== undefined) throw new Error(this.failOpen);
		await super.open(url);
	}

	override async waitForReplyStable(options: WaitForReplyOptions): Promise<WaitForReplyResult> {
		if (this.replyDelayMs === Number.POSITIVE_INFINITY) {
			await new Promise<void>((_resolve, reject) => {
				this.closeListeners.push(() =>
					reject(new Error("Target page, context or browser has been closed")),
				);
			});
		} else if (this.replyDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, this.replyDelayMs));
		}
		return super.waitForReplyStable(options);
	}

	override async close(): Promise<void> {
		await super.close();
		for (const listener of this.closeListeners.splice(0)) listener();
	}
}

export type ScriptedModelFactoryScripts = Partial<Record<ModelRole, () => ScriptedChatModel>>;

/** Hands out a fresh scripted model per `forRole` call so repeated runs do not share scripts. */
export class ScriptedModelFactory implements ModelFactory {
	readonly built: Array<{ role: ModelRole; model: ScriptedChatModel }> = [];
	/** When set, `forRole` rejects with it (simulates an unconfigured provider). */
	failure: Error | undefined;

	constructor(private readonly scripts: ScriptedModelFactoryScripts) {}

	async forRole(
		role: ModelRole,
		_settings: Settings,
		_options?: CreateModelOptions,
	): Promise<BaseChatModel> {
		if (this.failure) throw this.failure;
		const make = this.scripts[role];
		if (!make) throw new Error(`ScriptedModelFactory: no script for role '${role}'`);
		const model = make();
		this.built.push({ role, model });
		return model;
	}

	async fromRef(ref: string): Promise<BaseChatModel> {
		throw new Error(`ScriptedModelFactory: fromRef('${ref}') is not supported`);
	}

	/** Models built for `role`, in creation order. */
	models(role: ModelRole): ScriptedChatModel[] {
		return this.built.filter((b) => b.role === role).map((b) => b.model);
	}
}

export type TempWorkspace = {
	root: string;
	workspace: Workspace;
	runStore: RunStore;
	cleanup: () => Promise<void>;
};

/** A throwaway workspace initialised from the shipped templates, plus its run store. */
export async function makeTempWorkspace(): Promise<TempWorkspace> {
	const root = await mkdtemp(join(tmpdir(), "ae-runner-"));
	const workspace = openWorkspace(root);
	await workspace.init();
	const settings = await workspace.loadSettings();
	const runStore = openRunStore(join(root, settings.runs_dir));
	return {
		root,
		workspace,
		runStore,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

/** Rewrites one resource in place through the validating `writeRaw`. */
export async function editResource(
	workspace: Workspace,
	kind: "scenario" | "target" | "settings" | "evaluator" | "rubric",
	name: string | undefined,
	edit: (raw: string) => string,
): Promise<void> {
	const raw = await workspace.readRaw(kind, name);
	await workspace.writeRaw(kind, edit(raw), name);
}
