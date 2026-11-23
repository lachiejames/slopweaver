/**
 * `slopweaver atlas nx-cloud refresh [--org <id>] [--workspace <id>] [--json] [--home <dir>]` — the ONE
 * command that brings both surfaces current, which is what `AtlasDescriptor.resyncCommand` promises.
 *
 * It runs the `web-data` sync and then the browser walk, in that order, and reports both. The order matters
 * twice over. The sync is seconds and the walk is minutes, so a failure in the cheap leg is worth knowing
 * before the browser is driven at all. And the sync is what STORES the scope: a first run given
 * `--org`/`--workspace` leaves the pair in the generation, so the walk that follows resolves it without the
 * flags even if a later run drops them.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_OK } from "../../exitCodes.js";

import { nxCloudAtlasSyncCommand } from "./syncRun.js";
import { nxCloudAtlasWalkCommand } from "./walkRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NX_CLOUD_REFRESH_USAGE =
  "usage: slopweaver atlas nx-cloud refresh [--org <id>] [--workspace <id>] [--json] [--home <dir>]";

/**
 * Swap the verb the sub-command reads out of argv, so each one parses its own tail unchanged.
 *
 * @param argv the whole process argv
 * @param verb the verb to substitute
 * @returns the argv the sub-command sees
 */
function argvFor({ argv, verb }: { argv: readonly string[]; verb: string }): readonly string[] {
  return argv.map((value, index) => (index === 4 ? verb : value));
}

/**
 * Bring both Nx Cloud surfaces current.
 *
 * @param argv the whole process argv
 * @returns the process exit code — the first non-zero of the two legs
 */
export async function nxCloudAtlasRefreshCommand(argv: readonly string[]): Promise<number> {
  const tail = new Set(argv.slice(5));
  if (tail.has("--help") || tail.has("-h")) {
    logger.out({ line: NX_CLOUD_REFRESH_USAGE });
    return EXIT_OK;
  }
  const synced = await nxCloudAtlasSyncCommand(argvFor({ argv, verb: "sync" }));
  if (synced !== EXIT_OK) {
    logger.error({ msg: "the web-data surface could not be published, so the browser walk was not started" });
    return synced;
  }
  return nxCloudAtlasWalkCommand(argvFor({ argv, verb: "walk" }));
}
