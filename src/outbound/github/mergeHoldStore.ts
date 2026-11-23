/**
 * Durable I/O for the merge hold — one small JSON document under the state home, read by every merge and
 * written only by `github hold`/`github release`.
 *
 * Every decision about a hold is a pure function in `./mergeHold.ts`; this module reads and replaces bytes.
 * The write goes through {@link writeJsonFile}, so it is atomic and crash-durable for the reason
 * `lib/writeAtomic.ts` gives: a torn hold document is one that stops refusing, and a hold that silently
 * stops refusing is the whole failure this mechanism exists to remove.
 *
 * The directory is created owner-only (`0700`), matching every other `live/` surface: the document names
 * the sessions running on this machine, which is not a credential but is nobody else's business either.
 *
 * A missing file is the ordinary starting state and reads as "nothing is held" — never an error. That is
 * deliberate and load-bearing: `github merge` consults this on every invocation, and a home that has never
 * placed a hold must not have its merges refused by the absence of a file.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { slopweaverHome } from "../../config.js";
import { readJsonFile, writeJsonFile } from "../../lib/jsonFile.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { type MergeHold, mergeHoldDocument, parseMergeHolds } from "./mergeHold.js";

/** Owner-only, matching the rest of `live/`. */
const DIR_MODE = 0o700;

/**
 * Where the hold document lives.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute path to the document
 */
export function mergeHoldPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).live.github.mergeHoldJson;
}

/**
 * Every hold standing in one home.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns every decodable hold, or none at all when the document is absent or unreadable
 */
export function readMergeHolds({ home = slopweaverHome() }: { home?: string } = {}): readonly MergeHold[] {
  return parseMergeHolds({ raw: readJsonFile({ path: mergeHoldPath({ home }) }) });
}

/**
 * Replace the whole set of standing holds.
 *
 * Whole-document rather than per-hold, because the set is at most one entry per repository and a partial
 * update would need a lock this design deliberately does not have — the writers are `hold` and `release`,
 * both typed by an operator or by a merge that has already succeeded, never a loop.
 *
 * @param holds the holds that should stand after this write
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the one-line reason the write failed
 */
export function writeMergeHolds({
  holds,
  home = slopweaverHome(),
}: {
  holds: readonly MergeHold[];
  home?: string;
}): Result<void> {
  const path = mergeHoldPath({ home });
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    writeJsonFile({ path, value: mergeHoldDocument({ holds }) });
  } catch (error: unknown) {
    return err([`could not write the merge hold at ${path}: ${String(error)}`]);
  }
  return ok(undefined);
}
