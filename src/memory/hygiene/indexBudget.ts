/**
 * CHECK 2 — `MEMORY.md` against the loader's own read limit, and which memories fall off the end of it.
 *
 * Pure: hand it the index text and its pointers, get back a measurement.
 *
 * ## The limit, quoted from the authority rather than remembered
 *
 * code.claude.com/docs/en/memory: _"The first 200 lines of `MEMORY.md`, or the first
 * 25KB, whichever comes first, are loaded at the start of every conversation. Content beyond that threshold
 * is not loaded at session start."_
 *
 * ## Why this is not a second implementation of something the tool already does
 *
 * `../types.ts` deliberately OMITS an index load-limit check from `MEMORY_CHECK_IDS`, on the ground that
 * Claude Code enforces the budget itself. That is true, and it is precisely why the gap this check fills
 * exists. From the same page: _"After Claude writes to `MEMORY.md`, Claude Code measures the file against the
 * 200-line and 25KB read limits."_ Three consequences, none of them covered:
 *
 * - The measurement is triggered by **Claude Code's own write**. An index pushed over budget by a hand edit,
 *   a `git checkout`, a file copy, or on a version predating the check is never measured at all.
 * - The reminder goes to **Claude, in the session that wrote it**. Nothing tells the owner, and the session
 *   that heard it ends.
 * - Nothing measures the **standing state on a cadence**, which is the only thing that catches an index that
 *   has been quietly truncating for a fortnight.
 *
 * So `memory check`'s omission is right — a human typing `check` gets the tool's own reminder anyway — and a
 * scheduled pass needs this. Both files say so, deliberately, so the next reader does not correctly conclude
 * one of them is a regression.
 *
 * ## What earns the check its place
 *
 * Not the byte count. The POINTERS BELOW THE CUT: the memories `MEMORY.md` routes and the loader never reads,
 * which are therefore invisible at session start while looking perfectly healthy on disk. Nothing else in
 * this system will ever say which those are.
 */
import type { MemoryIndex } from "../types.js";
import { type IndexBudget, NEAR_LIMIT_SHARE } from "./types.js";

/**
 * Lines of `MEMORY.md` the loader reads.
 *
 * @internal
 */
export const INDEX_LINE_LIMIT = 200;

/**
 * Bytes of `MEMORY.md` the loader reads. 25KB, as the documentation writes it — 25 × 1024.
 *
 * @internal
 */
export const INDEX_BYTE_LIMIT = 25 * 1024;

/** Where the loader stops, and which limit stopped it. */
interface CutPoint {
  readonly limitReached: "lines" | "bytes" | null;
  readonly cutAtLine: number | null;
}

/**
 * The first line at which either limit is reached.
 *
 * Bytes are accumulated per line INCLUDING its newline, because that is what the file holds — a measurement
 * that dropped the newlines would put the cut later than the loader does, which is the direction that reports
 * a truncating index as healthy.
 *
 * The line limit is checked against the count of whole lines: with 201 lines, line 201 is the first one not
 * read, so the cut is at 200.
 */
function cutPoint({ lines }: { lines: readonly string[] }): CutPoint {
  let bytes = 0;
  for (const [position, line] of lines.entries()) {
    bytes += Buffer.byteLength(line, "utf8") + 1;
    if (bytes > INDEX_BYTE_LIMIT) {
      return { cutAtLine: position, limitReached: "bytes" };
    }
  }
  if (lines.length > INDEX_LINE_LIMIT) {
    return { cutAtLine: INDEX_LINE_LIMIT, limitReached: "lines" };
  }
  return { cutAtLine: null, limitReached: null };
}

/**
 * Whether an index that fits is close enough to a limit to be worth saying so.
 *
 * Only ever consulted for an index that has NOT crossed a limit — a crossed limit is the finding, and
 * reporting it as also-nearly-over would be two lines for one fact.
 */
function withinNearBand({ lines, bytes }: { lines: number; bytes: number }): boolean {
  const lineBand = INDEX_LINE_LIMIT * (1 - NEAR_LIMIT_SHARE);
  const byteBand = INDEX_BYTE_LIMIT * (1 - NEAR_LIMIT_SHARE);
  return lines >= lineBand || bytes >= byteBand;
}

/**
 * Measure one index against the loader's read limit.
 *
 * @param text the index's exact contents
 * @param index the parsed index, whose pointers are what a cut actually costs
 * @returns the measurement, including every pointer the loader never reaches
 */
export function measureIndexBudget({ text, index }: { text: string; index: MemoryIndex | null }): IndexBudget {
  const lines = text.split("\n");
  // A file ending in a newline splits to a trailing empty element that is not a line of content.
  const contentLines = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
  const bytes = Buffer.byteLength(text, "utf8");
  const cut = cutPoint({ lines: contentLines });
  const cutAtLine = cut.cutAtLine;
  if (cutAtLine === null) {
    return {
      bytes,
      cutAtLine: null,
      limitReached: null,
      lines: contentLines.length,
      nearLimit: withinNearBand({ bytes, lines: contentLines.length }),
      pointersBelowCut: [],
    };
  }
  const below = index === null ? [] : index.pointers.filter((pointer) => pointer.line > cutAtLine);
  return {
    bytes,
    cutAtLine,
    limitReached: cut.limitReached,
    lines: contentLines.length,
    // A crossed limit is the finding; `nearLimit` is only ever about an index that still fits.
    nearLimit: false,
    pointersBelowCut: below.map((pointer) => pointer.target),
  };
}
