/**
 * One walk of Codex's `$CODEX_HOME/sessions/YYYY/MM/DD/` tree: which rollout files a reader may open, and how many
 * places the walk passed over that could hold a later reading than any it found. Split from `./quotaLog.ts`, which
 * reads what a rollout SAYS; this module only decides which files there are, so both readers of an undocumented
 * layout share one criterion (`rolloutEntryState`) rather than drifting.
 */

import { accessSync, constants, type Dirent, lstatSync, readdirSync, type Stats, statSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "#lib/parsers.js";

/** One candidate rollout file — split from the filesystem walk so "pick the latest" stays pure and testable. */
export interface RolloutCandidate {
  readonly path: string;
  readonly mtimeMs: number;
}

/**
 * Pick the most-recently-modified candidate. Pure.
 *
 * @param candidates every rollout file found, with its mtime
 * @returns the latest candidate, or undefined when there are none
 */
export function latestRolloutCandidate({
  candidates,
}: {
  candidates: readonly RolloutCandidate[];
}): RolloutCandidate | undefined {
  return candidates.reduce<RolloutCandidate | undefined>(
    (latest, candidate) => (latest === undefined || candidate.mtimeMs > latest.mtimeMs ? candidate : latest),
    undefined,
  );
}

/** How deep `sessions/` nests before a rollout file: year, month, day. */
const SESSION_DIR_DEPTH = 3;

/** One walk of `sessions/`: every rollout it accepted, and how many places it passed over in silence. */
export interface RolloutWalk {
  /** Every accepted rollout file, in walk order. */
  readonly candidates: readonly RolloutCandidate[];
  /**
   * How many places the walk passed over, any of which could hold a later reading than one it found: a directory that
   * exists but cannot be both listed and searched, ANY symlink listed above a day directory, a directory or ANY symlink
   * listed inside a day directory, a `.jsonl` file above one, and a `.jsonl` entry it refuses (not a regular file, more
   * than one name, or one `lstat` cannot reach). A symlink counts whatever it points at, because telling a link to a
   * directory from a link to a file means following it, which the walk never does: a link to a plain file is
   * over-counted, never a link to a directory under-counted. The symlink rule is for ENTRIES the walk lists: `sessions/` itself is the root the walk
   * starts from, so a symlinked `sessions/` is followed, as `./quotaLog.ts`'s `dayDirsNewestFirst` follows it — a home
   * whose sessions were moved to another volume still reads, and every file reached through it still passes
   * `rolloutEntryState`'s regular-file, one-name test.
   */
  readonly hiddenPlaces: number;
}

/**
 * Walk `sessions/` ONCE, collecting the rollouts and counting what it had to pass over in the same pass.
 *
 * Every place counted reads as empty to a walk, so a scan that met one reported an older reading as the current one.
 * The count is taken in the SAME walk that
 * collects candidates, never a second one, so a directory that is unreadable while it is walked and readable a moment
 * later cannot be missed by the first and look healthy to the second. Each counts whatever its age: a resumed
 * session APPENDS to its rollout in the day directory it started in, moving the file's mtime and not the directory's
 * A refused link is still refused, never read: counting it only stops an older reading posing as the current
 * one. A missing `sessions/` is a home Codex never ran in, so it alone is not counted; a file or directory the walk
 * listed and found gone a moment later was there when it was listed, so it counts.
 *
 * **What it does not close: a tree that changes UNDER the walk.** Every check here is by path, so a directory the
 * listing typed as a directory and then swapped for a symlink before the walk descends is followed, uncounted. A re-`lstat` before descending has the same gap one call later; closing
 * it needs a descriptor walk (`openat` with `O_NOFOLLOW | O_DIRECTORY`), which Node's `fs` does not expose. The
 * reach is bounded: staging the swap needs write access inside `sessions/`, which already lets anyone plant a file
 * there directly, and every file reached through it still passes {@link rolloutEntryState}'s regular-file, one-name
 * test before a byte is read.
 *
 * @param codexHome the Codex home to walk
 * @returns the accepted rollouts and the count of places passed over
 */
export function walkRollouts({ codexHome }: { codexHome: string }): RolloutWalk {
  const candidates: RolloutCandidate[] = [];
  let hiddenPlaces = 0;
  const visit = ({ depth, dir }: { depth: number; dir: string }): void => {
    const listed = listForWalk({ depth, dir });
    if (listed === "absent") {
      return;
    }
    if (listed === "hidden") {
      hiddenPlaces += 1;
      return;
    }
    for (const entry of listed) {
      const kind = walkEntryKind({ depth, entry });
      const path = join(dir, entry.name);
      if (kind === "descend") {
        visit({ depth: depth + 1, dir: path });
      } else if (kind === "hidden") {
        hiddenPlaces += 1;
      } else if (kind === "rollout") {
        // A rollout listed and gone by its `lstat` was there when the walk listed it, and unread, so it counts like a
        // refused one.
        const state = rolloutEntryState({ path });
        if (typeof state === "object") {
          candidates.push({ mtimeMs: state.mtimeMs, path });
        } else {
          hiddenPlaces += 1;
        }
      }
    }
  };
  visit({ depth: 0, dir: join(codexHome, "sessions") });
  return { candidates, hiddenPlaces };
}

/**
 * List one directory of the walk: its entries in walk order, `"hidden"` when it exists and cannot be both listed and
 * searched, or `"absent"` for the one place whose absence is not counted, a missing `sessions/`.
 *
 * @param depth how far below `sessions/` the directory sits; 0 is `sessions/` itself
 * @returns the entries, directories newest (highest name) first, or why there are none to read
 */
function listForWalk({ depth, dir }: { depth: number; dir: string }): readonly Dirent[] | "absent" | "hidden" {
  // READ lists a directory and SEARCH (x) is what opening or stat-ing anything inside it needs. One without the
  // other hides every rollout below as surely as neither: a 0400 day directory lists, and then every `lstat` in
  // it fails.
  // Below `sessions/` itself, a directory failing this was listed by its parent a moment ago, so even one gone since
  // counts: it was there when the walk listed it. Only a missing `sessions/` is not counted.
  // Both failures below answer by this one rule, so a `sessions/` that is not a directory at all (a regular file, which
  // passes `accessSync` and fails `readdirSync` with ENOTDIR) is absent rather than a place passed over.
  const unreadable = (): "absent" | "hidden" => {
    const countsAsHidden = depth > 0 || !knownNotADirectory({ dir });
    return countsAsHidden ? "hidden" : "absent";
  };
  try {
    accessSync(dir, constants.R_OK | constants.X_OK);
  } catch {
    return unreadable();
  }
  // No entry leaves here with an unknown type: for a `DT_UNKNOWN` entry (a FUSE mount, say) the sync
  // `readdirSync(…, { withFileTypes: true })` lstats it into its real type, and an lstat that fails throws out of
  // the readdir into the catch, which counts the directory (read it on the pinned Node with
  // `node --expose-internals -p "require('internal/fs/utils').getDirent.toString()"`).
  let listed: readonly Dirent[];
  try {
    listed = readdirSync(dir, { withFileTypes: true });
  } catch {
    return unreadable();
  }
  // Directories newest (highest name) first, as `./quotaLog.ts`'s `dayDirsNewestFirst` walks them, so candidates
  // tied on mtime keep the order every earlier reader of this walk saw; a day directory's files stay in listing order.
  if (depth < SESSION_DIR_DEPTH) {
    return listed.toSorted((left, right) => compareNamesDescending({ left: left.name, right: right.name }));
  }
  return listed;
}

/**
 * What the walk does with one listed entry. Pure over the entry's own name and type.
 *
 * @param depth how far below `sessions/` the entry's directory sits
 * @param entry the listed entry
 * @returns `descend` into a layout directory, `rollout` for a day directory's `.jsonl` entry, `hidden` for a place
 *   passed over that could hold a reading, `ignore` for a file that is not a rollout at all
 */
function walkEntryKind({
  depth,
  entry,
}: {
  depth: number;
  entry: Dirent;
}): "descend" | "hidden" | "ignore" | "rollout" {
  const namedAsRollout = entry.name.endsWith(".jsonl");
  if (depth === SESSION_DIR_DEPTH) {
    if (namedAsRollout) {
      return "rollout";
    }
    // A directory (or a link to one) inside a day directory is not Codex's layout, and the walk does not descend
    // into it, so it is a place a later rollout could sit unread. A non-`.jsonl` FILE is not a
    // rollout at all and carries no reading.
    const isPlace = entry.isDirectory() || entry.isSymbolicLink();
    return isPlace ? "hidden" : "ignore";
  }
  if (entry.isSymbolicLink()) {
    return "hidden";
  }
  if (entry.isDirectory()) {
    return "descend";
  }
  // A rollout above the day directory is outside the layout the walk reads, so it is passed over, and counted.
  return namedAsRollout ? "hidden" : "ignore";
}

/**
 * Two names in the order `./quotaLog.ts`'s `subdirsNewestFirst` puts them: default string order, reversed.
 *
 * @returns negative when `left` sorts first
 */
function compareNamesDescending({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 0;
  }
  return left > right ? -1 : 1;
}

/**
 * Whether one `.jsonl` entry in a day directory is a rollout a reader may open, one it refuses, or one that vanished
 * between listing and `lstat`. The one criterion {@link walkRollouts} and `./quotaLog.ts`'s `rolloutFilesIn` both
 * read, so the count and the walk cannot drift.
 *
 * @param path the entry
 * @returns the entry's state, and its mtime when accepted
 */
export function rolloutEntryState({ path }: { path: string }): "gone" | "refused" | { readonly mtimeMs: number } {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    return isRecord(error) && error["code"] === "ENOENT" ? "gone" : "refused";
  }
  // `lstat`, so a SYMLINK is seen as a symlink rather than as whatever it points at, and refused. A Codex review
  // found the reach: a `rollout-*.jsonl` symlinked to `auth.json` is read line by line and `JSON.parse` assembles the
  // API key into an object before the event shape is checked. Nothing legitimate here is a link — Codex writes these
  // files itself. TWO conditions, and the second is as load-bearing as the first: `isFile` alone is satisfied by a
  // HARD LINK, which a second Codex review used to reach the same credential — same inode, a path inside the sessions
  // tree, and no link to detect. A rollout file Codex wrote has exactly ONE name, so `nlink === 1` is the file's own
  // invariant rather than a patch for one attack.
  if (!stat.isFile() || stat.nlink !== 1) {
    return "refused";
  }
  return { mtimeMs: stat.mtimeMs };
}

/**
 * Whether a path that would not list is KNOWN to be no directory: nothing at the path, or something that is not a
 * directory. A stat that fails any other way (EACCES behind an unsearchable parent, say) cannot tell, and a directory
 * it cannot see may hold a later reading, so it is not absent.
 *
 * @returns true only when the path is known to hold no directory
 */
function knownNotADirectory({ dir }: { dir: string }): boolean {
  try {
    return !statSync(dir).isDirectory();
  } catch (error) {
    return isRecord(error) && (error["code"] === "ENOENT" || error["code"] === "ENOTDIR");
  }
}

/**
 * Rollout candidates newest by mtime first; a tie keeps walk order.
 *
 * @param candidates the candidates in walk order
 * @returns a new array, newest first
 */
export function rolloutsNewestFirst({
  candidates,
}: {
  candidates: readonly RolloutCandidate[];
}): readonly RolloutCandidate[] {
  return candidates.toSorted((left, right) => right.mtimeMs - left.mtimeMs);
}

/**
 * The earliest mtime a `windowMs` horizon keeps: that far behind the newest file's mtime, capped at `nowMs` so a
 * future-dated file cannot drag the horizon forward past every real one.
 *
 * @param newestFirst the candidates, newest by mtime first
 * @param windowMs how far behind the anchor a file may be and still be inside the horizon
 * @param nowMs the scan instant the anchor is capped at
 * @returns the horizon's start in epoch milliseconds; with no candidate, nothing is excluded
 */
export function horizonStartMs({
  newestFirst,
  nowMs,
  windowMs,
}: {
  newestFirst: readonly RolloutCandidate[];
  nowMs: number;
  windowMs: number;
}): number {
  const newest = newestFirst[0];
  if (newest === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.min(newest.mtimeMs, nowMs) - windowMs;
}
