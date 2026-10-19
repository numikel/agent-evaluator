import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		cli: "src/cli/main.ts",
	},
	format: ["esm"],
	platform: "node",
	target: "node22",
	dts: true,
	clean: true,
	fixedExtension: false,
	outDir: "dist",
	banner: ({ fileName }) => (fileName === "cli.js" ? "#!/usr/bin/env node" : undefined),
});
