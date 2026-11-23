/**
 * `slopweaver atlas hex reset --confirm archive [--json] [--home <dir>]` — archive the current generation
 * and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is Hex's own is where its paths resolve and what an empty
 * generation looks like.
 */
import { resetHexAtlas } from "../../../atlas/hex/reset.js";
import { hexAtlasPaths } from "../../../atlas/hex/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HEX_RESET_USAGE = "usage: slopweaver atlas hex reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Hex atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function hexAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "hex",
    reset: ({ home, at }) => resetHexAtlas({ at, paths: hexAtlasPaths({ home }) }),
    usage: HEX_RESET_USAGE,
  });
}
