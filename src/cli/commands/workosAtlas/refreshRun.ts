/**
 * `slopweaver atlas workos refresh [--json] [--home <dir>]` — the ONE command that brings both surfaces
 * current, which is what `AtlasDescriptor.resyncCommand` promises a reader.
 *
 * It syncs first and then prints the walk brief, in that order, and the order matters twice over. The sync
 * is the cheap half and a failure there is worth knowing before anyone drives the owner's browser. And the
 * brief cannot be written until the sync has run at all: every dashboard address it names is read back out
 * of the `page` kind the sync publishes, so a brief built before a sync would name nothing.
 *
 * `EXIT_EXPECTED_EMPTY` from the sync is NOT a failure here — it is the ordinary state of an install whose
 * WorkOS access is an account record rather than a key, and the route map is fully published in exactly
 * that state.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

import { workosAtlasSyncCommand } from "./syncRun.js";
import { workosAtlasWalkCommand } from "./walkRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const WORKOS_REFRESH_USAGE = "usage: slopweaver atlas workos refresh [--json] [--home <dir>]";

/** Swap the verb the sub-command reads out of argv, so each one parses its own tail unchanged. */
function argvFor({ argv, verb }: { argv: readonly string[]; verb: string }): readonly string[] {
  return argv.map((value, index) => (index === 4 ? verb : value));
}

/**
 * Bring both WorkOS surfaces current.
 *
 * @param argv the whole process argv
 * @returns the sync's code when it genuinely failed, otherwise the walk brief's own
 */
export async function workosAtlasRefreshCommand(argv: readonly string[]): Promise<number> {
  const tail = new Set(argv.slice(5));
  if (tail.has("--help") || tail.has("-h")) {
    logger.out({ line: WORKOS_REFRESH_USAGE });
    return EXIT_OK;
  }
  const synced = await workosAtlasSyncCommand(argvFor({ argv, verb: "sync" }));
  if (synced !== EXIT_OK && synced !== EXIT_EXPECTED_EMPTY) {
    logger.error({ msg: "the API surface could not be published, so no dashboard walk was briefed" });
    return synced === EXIT_ERROR ? EXIT_ERROR : synced;
  }
  return workosAtlasWalkCommand(argvFor({ argv, verb: "walk" }));
}
