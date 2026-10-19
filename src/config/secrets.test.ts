import { describe, expect, it } from "vitest";
import { EnvSecretsProvider, StaticSecretsProvider } from "./secrets.js";

describe("EnvSecretsProvider", () => {
	it("reads values from the injected environment and treats blanks as unset", () => {
		const secrets = new EnvSecretsProvider({
			env: { ANTHROPIC_API_KEY: "sk-x", OPENAI_API_KEY: "   ", GROQ_API_KEY: "" },
		});
		expect(secrets.has("ANTHROPIC_API_KEY")).toBe(true);
		expect(secrets.get("ANTHROPIC_API_KEY")).toBe("sk-x");
		expect(secrets.has("OPENAI_API_KEY")).toBe(false);
		expect(secrets.get("OPENAI_API_KEY")).toBeUndefined();
		expect(secrets.has("GROQ_API_KEY")).toBe(false);
		expect(secrets.has("MISSING")).toBe(false);
	});

	it("defaults to process.env", () => {
		process.env.AE_TEST_SECRET_PROBE = "present";
		try {
			expect(new EnvSecretsProvider().has("AE_TEST_SECRET_PROBE")).toBe(true);
		} finally {
			delete process.env.AE_TEST_SECRET_PROBE;
		}
	});

	it("loads <workspaceRoot>/.env only when the file exists", () => {
		const loaded: string[] = [];
		const seen: string[] = [];
		new EnvSecretsProvider({
			env: {},
			workspaceRoot: "/ws",
			exists: (p) => {
				seen.push(p);
				return false;
			},
			loadEnvFile: (p) => loaded.push(p),
		});
		expect(seen).toEqual(["/ws/.env"]);
		expect(loaded).toEqual([]);

		new EnvSecretsProvider({
			env: {},
			workspaceRoot: "/ws",
			exists: () => true,
			loadEnvFile: (p) => loaded.push(p),
		});
		expect(loaded).toEqual(["/ws/.env"]);
	});

	it("ignores a broken .env file instead of crashing", () => {
		expect(
			() =>
				new EnvSecretsProvider({
					env: {},
					workspaceRoot: "/ws",
					exists: () => true,
					loadEnvFile: () => {
						throw new Error("parse error");
					},
				}),
		).not.toThrow();
	});

	it("does not touch the filesystem without a workspaceRoot", () => {
		let touched = false;
		new EnvSecretsProvider({
			env: {},
			exists: () => {
				touched = true;
				return true;
			},
			loadEnvFile: () => {
				touched = true;
			},
		});
		expect(touched).toBe(false);
	});
});

describe("StaticSecretsProvider", () => {
	it("serves a fixed map (for tests and embedding)", () => {
		const secrets = new StaticSecretsProvider({ OPENAI_API_KEY: "k", EMPTY: "" });
		expect(secrets.has("OPENAI_API_KEY")).toBe(true);
		expect(secrets.get("OPENAI_API_KEY")).toBe("k");
		expect(secrets.has("EMPTY")).toBe(false);
		expect(secrets.has("NOPE")).toBe(false);
	});
});
