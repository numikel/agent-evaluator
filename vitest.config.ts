import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@": `${root}src`,
			"@schemas": `${root}src/schemas`,
			"@ui": `${root}ui/src`,
		},
	},
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/testing/**", "src/**/types.ts"],
		},
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					environment: "node",
					include: ["src/**/*.test.ts", "fixtures/**/*.test.ts", "templates/**/*.test.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "ui",
					environment: "jsdom",
					include: ["ui/src/**/*.test.{ts,tsx}"],
					setupFiles: ["ui/src/test-setup.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "e2e",
					environment: "node",
					include: ["e2e/**/*.test.ts"],
					testTimeout: 180_000,
					hookTimeout: 180_000,
				},
			},
		],
	},
});
