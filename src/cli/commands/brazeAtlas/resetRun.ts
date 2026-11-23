/**
 * `slopweaver atlas braze reset --confirm archive [--json] [--home <dir>]` — archive the current generation
 * and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is this atlas's own is where its paths resolve and what an
 * empty generation looks like. The documentation row cache is left where it is, keyed by each page's own
 * modification instant, so a rebuild costs no re-fetch.
 */
import { resetBrazeAtlas } from "../../../atlas/braze/reset.js";
import { brazeAtlasPaths } from "../../../atlas/braze/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const BRAZE_RESET_USAGE = "usage: slopweaver atlas braze reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive this atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function brazeAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "braze",
    reset: ({ home, at }) => resetBrazeAtlas({ at, paths: brazeAtlasPaths({ home }) }),
    usage: BRAZE_RESET_USAGE,
  });
}
