/**
 * `slopweaver atlas notion refresh [--json] [--home <dir>]` — the ONE command that brings both surfaces
 * current, which is what `AtlasDescriptor.resyncCommand` promises a reader.
 *
 * It runs the API sync and then the browser walk, in that order, and reports both. The order matters: the
 * sync is offline and instant, so a failure there is worth knowing before five minutes of driving the
 * owner's browser. A failed sync therefore stops the refresh — publishing a walk against an API surface
 * that could not be read would leave a generation whose corroboration output is missing one whole side.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_OK } from "../../exitCodes.js";

import { notionAtlasSyncCommand } from "./syncRun.js";
import { notionAtlasWalkCommand } from "./walkRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const NOTION_REFRESH_USAGE = "usage: slopweaver atlas notion refresh [--json] [--home <dir>]";

/** Swap the verb the sub-command reads out of argv, so each one parses its own tail unchanged. */
function argvFor({ argv, verb }: { argv: readonly string[]; verb: string }): readonly string[] {
  return argv.map((value, index) => (index === 4 ? verb : value));
}

/**
 * Bring both Notion surfaces current.
 *
 * @param argv the whole process argv
 * @returns the process exit code — the first non-zero of the two legs
 */
export async function notionAtlasRefreshCommand(argv: readonly string[]): Promise<number> {
  const tail = new Set(argv.slice(5));
  if (tail.has("--help") || tail.has("-h")) {
    logger.out({ line: NOTION_REFRESH_USAGE });
    return EXIT_OK;
  }
  const synced = notionAtlasSyncCommand(argvFor({ argv, verb: "sync" }));
  if (synced !== EXIT_OK) {
    logger.error({ msg: "the API surface could not be published, so the browser walk was not started" });
    return synced;
  }
  return notionAtlasWalkCommand(argvFor({ argv, verb: "walk" }));
}
