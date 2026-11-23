/**
 * `slopweaver atlas nx-cloud reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * The verb's shape is `atlas/resetRunCore.ts`'s, which every atlas shares. What is this platform's is the
 * two lines below: which paths to resolve, and which reset to call.
 */
import { resetNxCloudAtlas } from "../../../atlas/nxCloud/reset.js";
import { nxCloudAtlasPaths } from "../../../atlas/nxCloud/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NX_CLOUD_RESET_USAGE = "usage: slopweaver atlas nx-cloud reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Nx Cloud atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function nxCloudAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "nx-cloud",
    reset: ({ home, at }) => resetNxCloudAtlas({ at, paths: nxCloudAtlasPaths({ home }) }),
    usage: NX_CLOUD_RESET_USAGE,
  });
}
