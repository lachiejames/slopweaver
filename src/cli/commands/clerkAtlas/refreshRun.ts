/**
 * `slopweaver atlas clerk refresh [--json] [--home <dir>]` — the ONE command that brings both surfaces
 * current, which is what `AtlasDescriptor.resyncCommand` promises a reader.
 *
 * It runs the compiled sync and then the dashboard walk, in that order, and reports both. The order
 * matters: the sync is offline once the documents are cached, so a failure there is worth knowing before
 * several minutes of driving the owner's browser. A failed sync therefore stops the refresh — publishing a
 * walk against a compiled surface that could not be read would leave a generation whose corroboration
 * output is missing one whole side, and `browserSurface.ts` would report every observed operation as
 * undocumented for want of anything to compare it to.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_OK } from "../../exitCodes.js";

import { clerkAtlasSyncCommand } from "./syncRun.js";
import { clerkAtlasWalkCommand } from "./walkRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const CLERK_REFRESH_USAGE = "usage: slopweaver atlas clerk refresh [--json] [--home <dir>]";

/** Swap the verb the sub-command reads out of argv, so each one parses its own tail unchanged. */
function argvFor({ argv, verb }: { argv: readonly string[]; verb: string }): readonly string[] {
  return argv.map((value, index) => (index === 4 ? verb : value));
}

/**
 * Bring both Clerk surfaces current.
 *
 * @param argv the whole process argv
 * @returns the process exit code — the first non-zero of the two legs
 */
export async function clerkAtlasRefreshCommand(argv: readonly string[]): Promise<number> {
  const tail = new Set(argv.slice(5));
  if (tail.has("--help") || tail.has("-h")) {
    logger.out({ line: CLERK_REFRESH_USAGE });
    return EXIT_OK;
  }
  const synced = await clerkAtlasSyncCommand(argvFor({ argv, verb: "sync" }));
  if (synced !== EXIT_OK) {
    logger.error({ msg: "the published surface could not be compiled, so the dashboard walk was not started" });
    return synced;
  }
  return clerkAtlasWalkCommand(argvFor({ argv, verb: "walk" }));
}
