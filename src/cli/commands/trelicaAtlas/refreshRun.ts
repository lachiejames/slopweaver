/**
 * `slopweaver atlas trelica refresh [--json] [--home <dir>]` — the one command the descriptor's
 * `resyncCommand` names: both API surfaces, then the browser one.
 *
 * ## The order is load-bearing
 *
 * The sync runs first because it needs only the cookie jar and finishes in seconds, so a signed-out browser
 * is reported before a walk spends a minute discovering the same thing one page at a time. The walk runs
 * second and its own publish merges onto whatever the sync just wrote — the publish lock and the
 * generation-moved check in `store.ts` are what make that safe rather than the ordering.
 *
 * ## The two halves fail asymmetrically
 *
 * A failed SYNC stops the refresh, whatever the cause: its exit code is returned unchanged and the walk is not
 * attempted. For a signed-out browser that is the reason above. It applies equally to a flag only the walk
 * accepts, such as `--limit`: both halves get the same tail, so the sync refuses it as usage and the walk never
 * runs. A failed
 * WALK after a good sync exits non-zero while the API surfaces it already published stay published: a refresh
 * that rolled back a good half would leave the atlas emptier than before it ran.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import { trelicaAtlasSyncCommand } from "./syncRun.js";
import { trelicaAtlasWalkCommand } from "./walkRun.js";

/** The effects a refresh runs, so the ordering and the exit codes can be driven without either real half. */
export interface TrelicaAtlasRefreshDeps {
  /** The API half — `atlas trelica sync`, given the argv it would have been invoked with. */
  readonly sync: (argv: readonly string[]) => Promise<number>;
  /** The browser half — `atlas trelica walk`, given the argv it would have been invoked with. */
  readonly walk: (argv: readonly string[]) => Promise<number>;
  /** Where a failed half's diagnostic goes. */
  readonly error: (args: { msg: string }) => void;
}

/**
 * Run both halves of the Trelica atlas refresh over injected halves: sync first, and the walk only after it
 * succeeded.
 *
 * @param argv the whole process argv; everything past the verb is forwarded to both halves unchanged
 * @param deps the two halves and the diagnostic sink
 * @returns the sync's own code when it failed, `EXIT_ERROR` when only the walk failed, else `EXIT_OK`
 */
export async function runTrelicaAtlasRefresh({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: TrelicaAtlasRefreshDeps;
}): Promise<number> {
  const tail = argv.slice(5);
  const synced = await deps.sync(["node", "slopweaver", "atlas", "trelica", "sync", ...tail]);
  if (synced !== EXIT_OK) {
    deps.error({ msg: "the API half failed, so the browser walk was not attempted" });
    return synced;
  }
  const walked = await deps.walk(["node", "slopweaver", "atlas", "trelica", "walk", ...tail]);
  if (walked !== EXIT_OK) {
    deps.error({ msg: "the API surfaces were published and the browser walk failed — the atlas is half current" });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Run both halves of the Trelica atlas refresh.
 *
 * @param argv the whole process argv
 * @returns the process exit code — non-zero when either half failed
 */
export async function trelicaAtlasRefreshCommand(argv: readonly string[]): Promise<number> {
  return runTrelicaAtlasRefresh({
    argv,
    deps: {
      error: ({ msg }) => {
        logger.error({ msg });
      },
      sync: trelicaAtlasSyncCommand,
      walk: trelicaAtlasWalkCommand,
    },
  });
}
