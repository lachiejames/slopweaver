/**
 * `slopweaver atlas datadog reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is Datadog's own is where its paths resolve and what an
 * empty generation looks like. It is also the remedy `atlas/datadog/store.ts` names when a generation on
 * disk carries a schema version this build no longer writes.
 */
import { resetDatadogAtlas } from "../../../atlas/datadog/reset.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const DATADOG_RESET_USAGE = "usage: slopweaver atlas datadog reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Datadog atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function datadogAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "datadog",
    reset: ({ home, at }) => resetDatadogAtlas({ at, home }),
    usage: DATADOG_RESET_USAGE,
  });
}
