import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SecretsProvider } from "./types.js";

export type EnvSecretsProviderOptions = {
	/** Source of values; defaults to `process.env`. */
	env?: Record<string, string | undefined>;
	/** When set, `<workspaceRoot>/.env` is loaded into `process.env` if (and only if) it exists. */
	workspaceRoot?: string;
	/** Injected for tests; defaults to `fs.existsSync`. */
	exists?: (path: string) => boolean;
	/** Injected for tests; defaults to `process.loadEnvFile` (existing variables win, nothing is written). */
	loadEnvFile?: (path: string) => void;
};

const normalize = (value: string | undefined): string | undefined => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

/**
 * Reads secrets from the environment (ADR-0002). Blank values count as unset. Optionally loads a
 * plain `.env` from the workspace root for local experiments; the file is never created or modified.
 */
export class EnvSecretsProvider implements SecretsProvider {
	private readonly env: Record<string, string | undefined>;

	constructor(options: EnvSecretsProviderOptions = {}) {
		this.env = options.env ?? process.env;
		if (options.workspaceRoot !== undefined) {
			const file = join(options.workspaceRoot, ".env");
			const exists = options.exists ?? existsSync;
			const load = options.loadEnvFile ?? ((path: string) => process.loadEnvFile(path));
			if (exists(file)) {
				try {
					load(file);
				} catch {
					// A malformed .env must not prevent the tool from starting; variables set in the
					// real environment still work.
				}
			}
		}
	}

	get(name: string): string | undefined {
		return normalize(this.env[name]);
	}

	has(name: string): boolean {
		return this.get(name) !== undefined;
	}
}

/** Fixed in-memory secrets, for tests and embedding scenarios. */
export class StaticSecretsProvider implements SecretsProvider {
	private readonly values: Record<string, string | undefined>;

	constructor(values: Record<string, string | undefined>) {
		this.values = { ...values };
	}

	get(name: string): string | undefined {
		return normalize(this.values[name]);
	}

	has(name: string): boolean {
		return this.get(name) !== undefined;
	}
}
