/**
 * `talk pack --write --if-older-than`'s half: whether the stored pack is fresh enough that the 19s gather is skipped.
 *
 * The console's pack keeper (`site/lib/packKeeper.ts`) asks this every 10 minutes, so the age is decided here, once,
 * and the console never parses the pack. The pure decision is `packRefreshDue` (`src/talk/storedPack.ts`); this file
 * is the read around it.
 */
import { readFileSync, statSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { type PackRefresh, packPastBound, packRefreshDue } from "../../../talk/storedPack.js";

/**
 * Whether the stored pack is due a rebuild, read the way a mint reads it: stat first, and only a regular file
 * within the byte bound, since a FIFO at this path would block a synchronous read forever.
 *
 * @param path where the pack is stored
 * @param olderThanMinutes the age past which it is rebuilt
 * @returns due with the reason, or fresh with its age
 */
export function storedPackRefresh({ path, olderThanMinutes }: { path: string; olderThanMinutes: number }): PackRefresh {
  const nowIso = new Date().toISOString();
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      return { due: true, why: `${path} is not a regular file` };
    }
    const pastBound = packPastBound({ bytes: stat.size, path });
    if (pastBound !== undefined) {
      return { due: true, why: pastBound };
    }
  } catch {
    return packRefreshDue({ nowIso, olderThanMinutes, text: undefined });
  }
  try {
    return packRefreshDue({ nowIso, olderThanMinutes, text: readFileSync(path, "utf8") });
  } catch (cause) {
    return { due: true, why: `could not read ${path}: ${String(cause)}` };
  }
}

/**
 * Say whether the stored pack is fresh enough to skip the build, and why, on stdout.
 *
 * @param home the state home whose pack is read
 * @param olderThanMinutes the flag's bound, `undefined` when it was not passed and the build always runs
 * @returns `true` when the stored pack is within the bound and nothing should be rebuilt
 */
export function storedPackStillFresh({
  home,
  olderThanMinutes,
}: {
  home: string;
  olderThanMinutes: number | undefined;
}): boolean {
  if (olderThanMinutes === undefined) {
    return false;
  }
  const refresh = storedPackRefresh({ olderThanMinutes, path: stateHomePaths({ home }).talkPackJson });
  if (refresh.due) {
    logger.out({ line: `talk pack: rebuilding — ${refresh.why}` });
    return false;
  }
  logger.out({
    line: `talk pack: fresh, ${String(refresh.ageMinutes)} minute(s) old, within ${String(olderThanMinutes)} — not rebuilt`,
  });
  return true;
}
