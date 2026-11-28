/**
 * Every run journal's claim on ONE worktree, read for `./treeOccupancy.ts`'s verdict — the effectful half.
 *
 * Every journal is read through `../handover/hookJournalScan.ts`'s one bounded buffer, and only a journal whose
 * bytes name the tree's directory name is parsed: a holder records the tree, or a directory beneath it, so its
 * journal carries that name in every spelling the machine uses (the `worktrees` alias and the `/private` prefix
 * change only what comes before it). The name is a FILTER, never the verdict — the parse and the exact path match
 * decide. MEASURED: 36 ms over 1,400 synthetic journals of ~9 KB, 43 ms over a real home of over 1,300; the whole
 * spawn gate, git's worktree listing included, took 86–118 ms. Repro, read-only, from a checkout:
 * `yarn tsx -e 'import("./src/cmux/treeHolderScan.ts").then(m=>{const t=performance.now();
 * m.scanTreeHolders({runsDir:process.argv[1],tree:process.cwd()});console.log(performance.now()-t)})' "$SLOPWEAVER_HOME/runs"`.
 *
 * A journal over the bound is never parsed but is still SEARCHED, in chunks of the same buffer; one naming the tree
 * holds it unparsed, so another row's spawn is refused there rather than let through on a skip.
 *
 * Residue, stated: a journal that will not read at all (not a regular file, a failed open) is skipped and COUNTED,
 * never guessed. The needle is the name as `JSON.stringify` writes it, which is every writer here; a hand-written
 * line escaping a plain character (`\/`, a `\u` escape) is not matched. A writer that recorded no worktree holds
 * nothing a path can name.
 */

import { basename } from "node:path";

import {
  journalIncludesBytes,
  journalReadBuffer,
  readJournalBytesBounded,
  slugsWithJournals,
} from "../handover/hookJournalScan.js";
import { parseLedger } from "../handover/ledger.js";
import { worktreePathKey } from "../worktree/location.js";
import { type TreeHolder, treeHoldersOf } from "./treeOccupancy.js";

/** What a scan found for one tree, and how many journals it could not read. */
export interface TreeHolderScan {
  readonly holders: readonly TreeHolder[];
  readonly unread: number;
}

/**
 * The bytes a journal line carries for the tree's directory name: `/` and the name as `JSON.stringify` writes it,
 * so a name holding a quote, a backslash or a control character is matched in its escaped form.
 *
 * @param tree the worktree being asked about, in any spelling
 * @returns the needle
 */
function treeNameNeedle({ tree }: { tree: string }): Buffer {
  return Buffer.from(`/${JSON.stringify(basename(worktreePathKey({ path: tree }))).slice(1, -1)}`, "utf8");
}

/**
 * The bytes that end a path segment inside a JSON string: its closing quote or a deeper `/`. A `\` never does — it
 * opens an escape INSIDE the name, so a sibling such as `seat"a` (written `seat\"a`) would match `seat`.
 */
const SEGMENT_ENDS = ['"', "/"] as const;

/**
 * The needle with each segment end after it — for an over-bound journal, where the match IS the holding, so a
 * sibling whose name merely starts with the tree's must not match.
 *
 * @param needle from {@link treeNameNeedle}
 * @returns one needle per segment end
 */
function segmentEndedNeedles({ needle }: { needle: Buffer }): readonly Buffer[] {
  return SEGMENT_ENDS.map((end) => Buffer.concat([needle, Buffer.from(end, "utf8")]));
}

/**
 * The holders every journal under `runsDir` records for directories that could be `tree` or beneath it.
 *
 * @param runsDir where journals live
 * @param tree the worktree being asked about, in any spelling
 * @returns the holders found — a superset of the tree's own, which the verdict narrows — and the unread count
 */
export function scanTreeHolders({ runsDir, tree }: { runsDir: string; tree: string }): TreeHolderScan {
  const needle = treeNameNeedle({ tree });
  const buffer = journalReadBuffer();
  const holders: TreeHolder[] = [];
  let unread = 0;
  for (const slug of slugsWithJournals({ runsDir })) {
    const bytes = readJournalBytesBounded({ buffer, runsDir, slug });
    if (bytes === undefined) {
      // Over the bound, so never parsed: searched in chunks instead, and a journal naming the tree holds it
      // UNPARSED — the verdict refuses another row's rather than reading a skipped journal as a free tree.
      const names = journalIncludesBytes({ buffer, needles: segmentEndedNeedles({ needle }), runsDir, slug });
      if (names === undefined) {
        unread += 1;
      } else if (names) {
        holders.push({ path: tree, sessionId: undefined, slug, via: "unparsed" });
      }
      continue;
    }
    if (!bytes.includes(needle)) {
      continue;
    }
    holders.push(...treeHoldersOf({ events: parseLedger({ text: bytes.toString("utf8") }).events, slug }));
  }
  return { holders, unread };
}
