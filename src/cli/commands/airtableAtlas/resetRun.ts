/**
 * `slopweaver atlas airtable reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is Airtable's own is where its paths resolve and what an
 * empty generation looks like.
 */
import { resetAirtableAtlas } from "../../../atlas/airtable/reset.js";
import { airtableAtlasPaths } from "../../../atlas/airtable/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const AIRTABLE_RESET_USAGE = "usage: slopweaver atlas airtable reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Airtable atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function airtableAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "airtable",
    reset: ({ home, at }) => resetAirtableAtlas({ at, paths: airtableAtlasPaths({ home }) }),
    usage: AIRTABLE_RESET_USAGE,
  });
}
