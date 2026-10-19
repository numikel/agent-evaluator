import { FsWorkspace } from "./files.js";
import { FsRunStore } from "./run-store.js";
import type { RunStore, Workspace } from "./types.js";

export { FsWorkspace, packageRoot, ResourceNotFoundError, TEMPLATE_FILES } from "./files.js";
export { joinFrontmatter, splitFrontmatter } from "./frontmatter.js";
export { FsRunStore } from "./run-store.js";
export * from "./types.js";

/** Opens the workspace rooted at `root` (nothing is created until `init` is called). */
export function openWorkspace(root: string): Workspace {
	return new FsWorkspace(root);
}

/** Opens a run store whose runs live directly under `root` (typically `<workspace>/<runs_dir>`). */
export function openRunStore(root: string): RunStore {
	return new FsRunStore(root);
}
