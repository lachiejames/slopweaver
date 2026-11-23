/**
 * `slopweaver atlas inngest reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is this atlas's own is where its paths resolve and what an
 * empty generation looks like.
 */
import { resetInngestAtlas } from "../../../atlas/inngest/reset.js";
import { inngestAtlasPaths } from "../../../atlas/inngest/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const INNGEST_RESET_USAGE = "usage: slopweaver atlas inngest reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive this atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function inngestAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "inngest",
    reset: ({ home, at }) => resetInngestAtlas({ at, paths: inngestAtlasPaths({ home }) }),
    usage: INNGEST_RESET_USAGE,
  });
}
