/**
 * `slopweaver atlas microsoft365 reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is this atlas's own is where its paths resolve and what an
 * empty generation looks like. The cached specification is left where it is, named by the immutable commit it
 * came from, so a rebuild costs no download.
 */
import { resetMicrosoft365Atlas } from "../../../atlas/microsoft365/reset.js";
import { microsoft365AtlasPaths } from "../../../atlas/microsoft365/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const MICROSOFT365_RESET_USAGE =
  "usage: slopweaver atlas microsoft365 reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive this atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function microsoft365AtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "microsoft365",
    reset: ({ home, at }) => resetMicrosoft365Atlas({ at, paths: microsoft365AtlasPaths({ home }) }),
    usage: MICROSOFT365_RESET_USAGE,
  });
}
