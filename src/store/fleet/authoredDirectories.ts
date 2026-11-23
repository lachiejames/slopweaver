/**
 * Every top-level directory of the state home, classified — the declaration the `authored` import leg reads.
 *
 * A loss audit of the state home counted briefs, artifacts, judgement, profile, registers, morning and the
 * rest — 257 MB, 12,697 files — across about thirty small directories in no backup, no remote and no provider,
 * so each one needs classifying as authored or scratch before any table. This file is that classification, one line of
 * reason per directory, so the next reader can argue with a row rather than re-derive the whole list.
 *
 * This module holds the row types, the top-level FILE rows and the classify helpers, and composes the table from
 * its sections: `./authoredDirectoryRows.ts` (the authored directories), `./unimportedDirectoryRows.ts` (scratch,
 * credential and other-class) and `./liveClassification.ts` (the `live` tree). A new state path adds a row in its
 * section's file — it must, or it is never backed up — and a section file nearing 300 code lines splits again.
 *
 * ## Four classes, and only one of them is imported
 *
 * - `authored` — the fleet wrote it, nothing can rebuild it, and it is not some other row's class. These are
 *   read into `authored_body` / `authored_file` by `store import-fleet --only authored`.
 * - `scratch` — reproducible, or dead by what it is: a log, a query's own working files, a re-taken reading.
 *   Named so it is a decision, never imported.
 * - `credential` — holds token material. Never imported: the store's dump goes to the backup destination as corpus
 *   data, and a credential there is a disclosure the owner has not made.
 * - `other-class` — a sibling migration owns it (a leg that already exists, or its own board row). Named so this
 *   class never quietly half-imports a directory another row is designing a table for.
 *
 * A fifth value, `split`, is not a class but the absence of one: a directory whose entries differ, so each is
 * classified by its own path below it. `live` is the case it exists for — the loss audit's live turn markers
 * and tag queue row sits beside 572 MB of browser session working files and the unredacted Slack attachments a
 * read fetched, under one top-level name.
 *
 * ## A row names a PATH, and the deepest row wins
 *
 * A row's name is a `/`-joined path under the home — `briefs`, or `live/slack/turn-markers`, or the file
 * `live/listener/queue.jsonl`. A path's class is the one on the DEEPEST row that is the path itself or an
 * ancestor of it, so a file row can carve the one authored file out of a scratch directory
 * (`live/listener` is process state; its `queue.jsonl` is the tag queue) and a scratch row can carve a
 * directory out of an authored one. Under a `split` directory there is no ancestor class to inherit: an entry
 * with no row of its own is unclassified, which the walk reports and never reads.
 *
 * A directory NOT in this list is unclassified — `store share` reports it in its residue — and the leg never
 * reads it. A new directory therefore stays out of the store until somebody classifies it, which is the
 * direction a mistake should fail in: a silent import of a credential directory is not recoverable, a missing
 * one is a line in a report.
 *
 * A top-level FILE is classified only by an exact row of its own, and most are not: of 83
 * (`ls -p ~/.slopweaver | grep -v / | wc -l`) the rest are `.bak` copies, one-off notes and caches, and stay
 * in the residue. The ones named are what a supervisor or the bot reads at boot, so a fresh machine that
 * restores the store gets them back ([new machine](../../../docs/store/new-machine.md)).
 * `hygiene-denylist.txt` is deliberately not one: every word in it is a word this leg refuses to store.
 */
import { AUTHORED_DIRECTORY_ROWS } from "./authoredDirectoryRows.js";
import { exact } from "./homeClassificationRow.js";
import { LIVE_CLASSIFICATION } from "./liveClassification.js";
import {
  CREDENTIAL_DIRECTORY_ROWS,
  OTHER_CLASS_DIRECTORY_ROWS,
  SCRATCH_DIRECTORY_ROWS,
} from "./unimportedDirectoryRows.js";

/**
 * Which class a top-level home directory belongs to.
 *
 * @internal read through {@link HomeDirectoryClassification}'s `directoryClass`, never named outside this file
 */
export type HomeDirectoryClass = "authored" | "scratch" | "credential" | "other-class" | "split";

/** One classified path, or a family of sibling entries sharing a name prefix. */
export interface HomeDirectoryClassification {
  /**
   * The entry's path under the home, `/`-joined — or, when {@link prefix} is set, that path's parent joined to the
   * prefix its family's names share.
   */
  readonly name: string;
  /** Whether {@link name}'s last segment is a prefix matching a dated family (`memory-deindexed-02sep`, …). */
  readonly prefix: boolean;
  readonly directoryClass: HomeDirectoryClass;
  /** Why it is in that class — the reader's one line to argue with. */
  readonly because: string;
}

/**
 * The home's top-level FILES that are authored — named apart from the directories because a row alone cannot say
 * which of the two a one-segment name is, and the walk and the restore's path check both have to know.
 */
export const AUTHORED_HOME_FILES: readonly HomeDirectoryClassification[] = [
  exact({
    because: "the people the roster must never resolve to",
    directoryClass: "authored",
    name: "identity-exclusion.txt",
  }),
  exact({
    because: "which destination each seat boots against; a fresh machine otherwise guesses",
    directoryClass: "authored",
    name: "plans.json",
  }),
  exact({
    because: "the bot's persona, voice and main checkouts; init can only write a template",
    directoryClass: "authored",
    name: "profile.json",
  }),
  exact({
    because: "the one root each re-cut repository accepts; lost, a push of the old history goes through unrefused",
    directoryClass: "authored",
    name: "push-roots.json",
  }),
  exact({
    because: "who the bot answers; with no file the listener refuses every tag",
    directoryClass: "authored",
    name: "responders.json",
  }),
  exact({
    because: "the Slack authors a sync never ingests",
    directoryClass: "authored",
    name: "sync-author-denylist.txt",
  }),
  exact({
    because: "whose unruled asks the bot investigates; with no file nobody is on the tier",
    directoryClass: "authored",
    name: "trusted-askers.json",
  }),
  exact({
    because: "the kinds of ask the owner ruled the bot acts on unasked; with no file there are none",
    directoryClass: "authored",
    name: "general-rulings.json",
  }),
  exact({
    because: "the only record of a failed console refresh whose own ledger refused its row; nothing rebuilds it",
    directoryClass: "authored",
    name: "console-sync-failure-append-failures.jsonl",
  }),
];

/**
 * Whether a one-segment path names one of {@link AUTHORED_HOME_FILES}.
 *
 * @param name a top-level entry of the home
 * @returns true only for a top-level file this class stores
 */
export function isAuthoredHomeFile({ name }: { name: string }): boolean {
  return AUTHORED_HOME_FILES.some((row) => row.name === name);
}

/** The classification, in class order then name order; the top-level files first. */
export const HOME_DIRECTORY_CLASSIFICATION: readonly HomeDirectoryClassification[] = [
  ...AUTHORED_HOME_FILES,
  ...AUTHORED_DIRECTORY_ROWS,
  ...SCRATCH_DIRECTORY_ROWS,
  ...CREDENTIAL_DIRECTORY_ROWS,
  ...OTHER_CLASS_DIRECTORY_ROWS,
  ...LIVE_CLASSIFICATION,
];

/**
 * The row naming exactly this path — an exact row first, then a prefix row over a sibling in the same parent.
 *
 * An exact row wins over a prefix row, so a family prefix can never swallow an entry classified by its own name.
 */
function rowAt({ path }: { path: string }): HomeDirectoryClassification | undefined {
  const exactRow = HOME_DIRECTORY_CLASSIFICATION.find((row) => !row.prefix && row.name === path);
  if (exactRow !== undefined) {
    return exactRow;
  }
  return HOME_DIRECTORY_CLASSIFICATION.find(
    (row) => row.prefix && parentOf({ path: row.name }) === parentOf({ path }) && startsLonger({ path, row }),
  );
}

/** Everything before a path's last `/`, or the empty string for a top-level name. */
function parentOf({ path }: { path: string }): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), 0));
}

/** Whether a path's name carries a prefix row's prefix and something after it. */
function startsLonger({ path, row }: { path: string; row: HomeDirectoryClassification }): boolean {
  return path.startsWith(row.name) && path.length > row.name.length;
}

/**
 * The classification a path under the home falls under: the deepest row that is the path or an ancestor of it.
 *
 * An entry directly under a `split` directory that has no row of its own is unclassified — `split` passes no
 * class down, which is what makes every entry of such a directory a decision somebody wrote. A top-level FILE
 * row passes nothing down either: nothing can sit under a file, so a path claiming to is refused.
 *
 * @param relativePath the path under the home, `/`-separated; a top-level entry is its bare name
 * @returns its row, or `undefined` when nothing classifies it
 */
export function classifyHomePath({ relativePath }: { relativePath: string }): HomeDirectoryClassification | undefined {
  const segments = relativePath.split("/");
  for (let depth = segments.length; depth >= 1; depth -= 1) {
    const row = rowAt({ path: segments.slice(0, depth).join("/") });
    if (row === undefined) {
      continue;
    }
    if (row.directoryClass === "split" && depth < segments.length) {
      return undefined;
    }
    if (depth < segments.length && AUTHORED_HOME_FILES.includes(row)) {
      return undefined;
    }
    return row;
  }
  return undefined;
}

/**
 * The classification a top-level directory name falls under.
 *
 * @param name a top-level entry of the home, as a listing returned it
 * @returns its row, or `undefined` when nothing classifies it
 */
export function classifyHomeDirectory({ name }: { name: string }): HomeDirectoryClassification | undefined {
  return classifyHomePath({ relativePath: name });
}

/**
 * Whether a path under the home is this class's to import.
 *
 * @param relativePath the path under the home, `/`-separated
 * @returns true only for a path whose deepest row is `authored`
 */
export function isAuthoredPath({ relativePath }: { relativePath: string }): boolean {
  return classifyHomePath({ relativePath })?.directoryClass === "authored";
}

/**
 * Whether the walk has to enter a directory: it is `authored` or `split`, or a deeper row carves an authored
 * entry out of it.
 *
 * @param relativePath the directory's path under the home, `/`-separated
 * @returns true when some file below it can be this class's
 */
export function mayHoldAuthored({ relativePath }: { relativePath: string }): boolean {
  const directoryClass = classifyHomePath({ relativePath })?.directoryClass;
  if (directoryClass === "authored" || directoryClass === "split") {
    return true;
  }
  return HOME_DIRECTORY_CLASSIFICATION.some(
    (row) => row.directoryClass === "authored" && row.name.startsWith(`${relativePath}/`),
  );
}
