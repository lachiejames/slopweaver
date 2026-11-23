/**
 * `slopweaver atlas jam refresh [--json] [--home <dir>]` — the one command the descriptor's `resyncCommand`
 * promises: publish the compiled tables, then walk the application.
 *
 * It exists because a multi-surface atlas is not brought current by either half alone, and `kit/contract.ts`
 * requires a single command that does. The two halves are sequenced rather than raced: they both publish the
 * `operation` and `integration` kinds' files, and the compare-and-swap in `store.ts` would refuse the second
 * if they overlapped.
 *
 * A failing walk does NOT fail the refresh. The sync needs no credential and always can run; the walk needs
 * the owner's Chrome to be attached and signed in, and reporting the whole refresh as failed because the browser was
 * not there would hide a compiled surface that did land. The exit code says which halves ran.
 *
 * Both halves take the same flag tail, so this rewrites the verb and passes the argv through untouched —
 * a refresh whose walk alone accepts a flag would have to strip it before the sync.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_OK } from "../../exitCodes.js";

import { jamAtlasSyncCommand } from "./syncRun.js";
import { runJamWalk } from "./walkRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const JAM_REFRESH_USAGE = "usage: slopweaver atlas jam refresh [--json] [--home <dir>]";

/** The argv with the `refresh` verb rewritten to whichever half is about to run. */
function argvFor({ argv, verb }: { argv: readonly string[]; verb: string }): readonly string[] {
  return argv.map((token, index) => (index === 4 && token === "refresh" ? verb : token));
}

/**
 * Run the sync, then the walk.
 *
 * @param argv the whole process argv, whose verb is rewritten for each half so both parse their own tail
 * @returns the sync's exit code when it failed, otherwise the walk's
 */
export async function jamAtlasRefreshCommand(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    logger.out({ line: JAM_REFRESH_USAGE });
    return EXIT_OK;
  }
  const synced = jamAtlasSyncCommand(argvFor({ argv, verb: "sync" }));
  if (synced !== EXIT_OK) {
    logger.error({ msg: "the compiled publish failed, so the walk was not attempted" });
    return synced;
  }
  return runJamWalk(argvFor({ argv, verb: "walk" }));
}
