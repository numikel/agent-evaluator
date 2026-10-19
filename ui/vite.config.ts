import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
	root: here,
	plugins: [react()],
	resolve: {
		alias: {
			"@schemas": `${here}../src/schemas`,
			"@ui": `${here}src`,
		},
	},
	build: {
		outDir: `${here}../dist/ui`,
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:4747",
		},
	},
});
