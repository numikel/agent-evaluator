import { describe, expect, it } from "vitest";
import { createFakeDeps, FakeSecrets } from "../../server/testing.js";
import { createCliHarness } from "../testing.js";

const CHROMIUM = "/opt/chromium/chrome";

const TARGET_YAML = "name: demo-chatbot\nurl: http://localhost:3999\n";

function harness(
	options: {
		secrets?: Record<string, string>;
		chromium?: boolean;
		/** Seeds `targets/demo-chatbot.yaml` and answers its probe (`undefined`: no target). */
		probe?: (url: string) => Promise<Response>;
	} = {},
) {
	const fakes = createFakeDeps();
	const probed: string[] = [];
	if (options.probe) fakes.workspace.files.set("targets/demo-chatbot.yaml", TARGET_YAML);
	const cli = createCliHarness({
		openWorkspace: () => fakes.workspace,
		providers: fakes.providers,
		secrets: new FakeSecrets(options.secrets ?? { ANTHROPIC_API_KEY: "k" }),
		chromiumExecutablePath: () => CHROMIUM,
		exists: (path) => (path === CHROMIUM ? (options.chromium ?? true) : true),
		fetch: async (input) => {
			probed.push(String(input));
			if (!options.probe) throw new Error("unexpected probe");
			return options.probe(String(input));
		},
	});
	return { ...cli, probed };
}

describe("doctor", () => {
	it("seam 4: prints the install hint and exits 1 when Chromium is missing", async () => {
		const cli = harness({ chromium: false });
		expect(await cli.run("doctor")).toBe(1);
		expect(cli.stdout()).toContain("✗ Chromium for Playwright");
		expect(cli.stdout()).toContain("npx playwright install chromium");
		expect(cli.stderr()).toMatch(/1 blocking problem/);
	});

	it("exits 0 with ✓ rows when the configured roles and Chromium are available", async () => {
		const cli = harness();
		expect(await cli.run("doctor")).toBe(0);
		expect(cli.stdout()).toContain("✓ Chromium for Playwright");
		expect(cli.stdout()).toContain("✓ simulator model");
		expect(cli.stdout()).toContain("✓ judge model");
		expect(cli.stdout()).toContain("✓ Anthropic (ANTHROPIC_API_KEY)");
		expect(cli.stdout()).toContain("All required checks passed");
	});

	it("exits 1 with an export hint when a configured role's provider has no key", async () => {
		const cli = harness({ secrets: { OPENAI_API_KEY: "k" } });
		expect(await cli.run("doctor")).toBe(1);
		expect(cli.stdout()).toContain("✗ simulator model");
		expect(cli.stdout()).toContain("export ANTHROPIC_API_KEY=");
		expect(cli.stdout()).not.toContain("k\n");
	});

	it("an unconfigured provider that no role uses is not blocking", async () => {
		const cli = harness();
		expect(await cli.run("doctor")).toBe(0);
		expect(cli.stdout()).toContain("✗ OpenAI (OPENAI_API_KEY)");
	});

	it("prints a ✓ row for a target that answers", async () => {
		const cli = harness({ probe: async () => new Response("ok") });
		expect(await cli.run("doctor")).toBe(0);
		expect(cli.probed).toEqual(["http://localhost:3999"]);
		expect(cli.stdout()).toContain("✓ Target demo-chatbot");
		expect(cli.stdout()).toContain("reachable at http://localhost:3999 (HTTP 200)");
	});

	it("an unreachable target is reported with the demo hint but does not block", async () => {
		const cli = harness({
			probe: async () => {
				throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
			},
		});
		expect(await cli.run("doctor")).toBe(0);
		expect(cli.stdout()).toContain("✗ Target demo-chatbot");
		expect(cli.stdout()).toContain("not reachable at http://localhost:3999 (ECONNREFUSED)");
		expect(cli.stdout()).toContain(
			"fix: start the chatbot (for the built-in demo: `agent-evaluator demo`",
		);
		expect(cli.stdout()).toContain("All required checks passed");
	});

	it("probes nothing when the workspace has no targets", async () => {
		const cli = harness();
		expect(await cli.run("doctor")).toBe(0);
		expect(cli.probed).toEqual([]);
		expect(cli.stdout()).not.toContain("Target ");
	});
});
