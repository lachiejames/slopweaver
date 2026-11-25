/**
 * The empty directory each throwaway session of `slopweaver fleet recover` runs in, so a check reads and writes nobody's
 * work: `$SLOPWEAVER_HOME/sessions/recovery-scratch/<attempt id>/fleet-recovery`.
 *
 * The last segment never changes, because a Claude seat's unbound credential store is named after its directory
 * (`../cmux/spawnDeps.ts`): a name per attempt would leave one store behind per check. The segment above it changes
 * every attempt, so a session never finds what an earlier one left. The Recovery lock keeps two checks from sharing it.
 *
 * Removal is the pass's decision, not this module's: a directory goes only once its session is proven gone.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { firstLinkedEntry } from "#lib/pathContainment.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { type FleetError, FleetErrors } from "./errors.js";

/** The directory every throwaway session runs in, under its own attempt's directory. */
const SESSION_DIRECTORY = "fleet-recovery";

/** Owner-only, like the session ledger beside it. */
const DIR_MODE = 0o700;

/**
 * Where a home's throwaway sessions run.
 *
 * @param home the state home
 * @returns the absolute directory every attempt's own directory sits in
 */
export function recoveryScratchRoot({ home }: { home: string }): string {
  return stateHomePaths({ home: resolve(home) }).recoveryScratch;
}

/** Refuse when any hop from the home down to `path` is a link. */
function refuseLinked({ home, path }: { home: string; path: string }): Result<void, FleetError> {
  const linked = firstLinkedEntry({ path, top: resolve(home) });
  if (linked !== undefined) {
    return err(FleetErrors.scratchLinked({ path: linked }));
  }
  return ok(undefined);
}

/**
 * Make one attempt's directory, which must not exist yet.
 *
 * @param attemptId the attempt, one path segment
 * @param home the state home
 * @returns the fresh, empty, owner-only directory the session runs in
 */
export function makeRecoveryScratch({
  attemptId,
  home,
}: {
  attemptId: string;
  home: string;
}): Result<string, FleetError> {
  const root = recoveryScratchRoot({ home });
  const directory = join(root, attemptId, SESSION_DIRECTORY);
  const safe = refuseLinked({ home, path: directory });
  if (safe.isErr()) {
    return err(safe.error);
  }
  try {
    mkdirSync(join(root, attemptId), { mode: DIR_MODE, recursive: true });
    mkdirSync(directory, { mode: DIR_MODE });
    return ok(directory);
  } catch (error: unknown) {
    return err(FleetErrors.io({ cause: error, path: directory }));
  }
}

/**
 * Remove every attempt's directory under a home. Called only when no session of a check is left running.
 *
 * @param home the state home
 * @returns nothing, or the failure
 */
export function clearRecoveryScratch({ home }: { home: string }): Result<void, FleetError> {
  const root = recoveryScratchRoot({ home });
  const safe = refuseLinked({ home, path: root });
  if (safe.isErr()) {
    return err(safe.error);
  }
  try {
    mkdirSync(root, { mode: DIR_MODE, recursive: true });
    for (const entry of readdirSync(root)) {
      rmSync(join(root, entry), { force: true, recursive: true });
    }
    return ok(undefined);
  } catch (error: unknown) {
    return err(FleetErrors.io({ cause: error, path: root }));
  }
}
