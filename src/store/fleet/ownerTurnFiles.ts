/**
 * Finding the `owner-turn-*.txt` files under a state home — the one walk both of their readers share.
 *
 * Two readers need it: the voice scan (`../../knowledge/voice/scan.ts`), which folds the owner's words into units,
 * and the `owner-turns` import leg, which stores them verbatim. One walk, so the two can never disagree about
 * which files exist.
 *
 * The walk is RECURSIVE under each family root, and never above one. A two-level walk loses files: 759 of the 30,125 files sit deeper — `supervisor-scratch/<handoff>/archive/` and
 * `supervisor-scratch/handoff-<n>/owner-turns/` — and two of those bodies exist at no shallower path, so a
 * shallow walk loses the owner's words outright. Measured, a full-depth walk of both roots takes about
 * 1.4 seconds (repro: `cd ~/.slopweaver && time find supervisor-scratch handovers/archive -name
 * 'owner-turn-*.txt' -type f | wc -l`), because a directory listing with entry types needs no per-file stat.
 * The walk itself is `./homeWalk.ts`, shared with the `measurements` leg.
 */
import { stateHomePaths } from "../../stateHome.js";

import { type HomeFileListing, listFilesUnder } from "./homeWalk.js";
import { OWNER_TURN_FILE, type OwnerTurnFamily } from "./ownerTurn.js";

/**
 * Each family's absolute root under a state home.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns one root per family
 */
export function ownerTurnRoots({ home }: { home?: string } = {}): Readonly<Record<OwnerTurnFamily, string>> {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  return { "archive-turn": paths.handoverArchive, "scratch-turn": paths.supervisorScratch };
}

/**
 * Every owner-turn file under one root, at any depth.
 *
 * @param root the family's root
 * @returns the files found and every directory that would not read
 */
export function listOwnerTurnFiles({ root }: { root: string }): HomeFileListing {
  return listFilesUnder({ accept: (fileName) => OWNER_TURN_FILE.test(fileName), root });
}
