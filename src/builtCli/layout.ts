/**
 * Where the built CLI lives on disk: the directory `slopweaver dev build` emits into and the entrypoint inside
 * it. Read by the verb that writes the tree, and by every reader that checks for one — a worktree's build, the
 * ref-move hook's rebuild — so it sits beside the staleness guard rather than inside the verb.
 */

/** Where the built CLI lands, relative to the repository root — never `dist`, which is tsc's `outDir`. */
export const DEFAULT_OUT = "dist-cli";

/** Where the emitted entrypoint lands, relative to the output directory. */
export const BUILT_ENTRYPOINT = "cli/index.js";
