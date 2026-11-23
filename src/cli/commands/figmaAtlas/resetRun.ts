/**
 * `slopweaver atlas figma reset --confirm archive [--json] [--home <dir>]` — archive the current generation
 * and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is Figma's own is where its paths resolve and what an
 * empty generation looks like.
 */
import { resetFigmaAtlas } from "../../../atlas/figma/reset.js";
import { figmaAtlasPaths } from "../../../atlas/figma/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const FIGMA_RESET_USAGE = "usage: slopweaver atlas figma reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Figma atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function figmaAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "figma",
    reset: ({ home, at }) => resetFigmaAtlas({ at, paths: figmaAtlasPaths({ home }) }),
    usage: FIGMA_RESET_USAGE,
  });
}
