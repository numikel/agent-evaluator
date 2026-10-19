import { describe, expect, it } from "vitest";
import { createFakeDeps, FakeSecrets } from "../../server/testing.js";
import { createCliHarness } from "../testing.js";

const CHROMIUM = "/opt/chromium/chrome";

function harness(options: { secrets?: Record<string, string>; chromium?: boolean } = {}) {
	const fakes = createFakeDeps();
	return createCliHarness({
		openWorkspace: () => fakes.workspace,
		providers: fakes.providers,
		secrets: new FakeSecrets(options.secrets ?? { ANTHROPIC_API_KEY: "k" }),
		chromiumExecutablePath: () => CHROMIUM,
		exists: (path) => (path === CHROMIUM ? (options.chromium ?? true) : true),
	});
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
});
