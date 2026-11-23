/**
 * The mailbox's `historyId` anchor — the durable half of the delta lane, and the only cursor in this
 * repository that reports a message ARRIVING rather than a message being newer than a date.
 *
 * ## Why a mailbox gets a second cursor when the other sources make do with one
 *
 * Every other connector resumes from a `tsIso`: fetch what changed since a moment, and re-list the whole
 * range to find out. Gmail is the one source whose API answers the question directly —
 * `users.history.list` returns exactly the messages added since a sequence id, so an incremental pass costs
 * one call rather than a walk over a window it mostly already holds.
 *
 * The stronger-sounding argument for it is wrong and is recorded here so nobody re-derives it: a message
 * delivered today with an old `Date:` header is NOT invisible to a date window, because Gmail filters on the
 * internal date, which is the same field this connector reads for `tsIso`. The sequence cursor's real edge
 * over the window is narrow — an imported message whose internal date was backdated past the crawl — and
 * the call cost is the rest of it. See `./fetch.ts` for the same note where the choice is made.
 *
 * ## The expiry is the normal case, not the edge case
 *
 * Google keeps roughly a week of history and answers an older `startHistoryId` with a 404. So a fortnight
 * away is not an unusual failure — it is what happens by default — and a design that treats expiry as an
 * error is a design that stops working the first time nobody runs a refresh over a holiday. The recovery
 * is a date-window crawl, and the file therefore records TWO facts rather than one: the anchor, and whether
 * the mailbox has ever been crawled end to end ({@link GmailHistoryAnchor.fullCrawl}).
 *
 * Both are load-bearing. Without the second, an expired anchor and a first-ever run look identical — and
 * they are not: the first has bronze behind it and needs only the window since the anchor was last good,
 * while the second has nothing and needs the whole mailbox. Shaped after
 * {@link ../slack/channelWatermark}, whose `fullHistory` marker exists for exactly this reason.
 *
 * ## The ORDER the anchor is taken in, which is the part that is easy to get wrong
 *
 * A crawl anchors on the `historyId` read BEFORE it starts, never the one current when it finishes.
 * Anchoring afterwards silently skips every message delivered while the crawl ran, and a real mailbox crawl
 * is long enough for that to be a window rather than a race. Re-reading a handful of messages the next pass
 * is free — bronze deduplicates — while missing them is permanent, so the asymmetry decides it.
 *
 * Writes are atomic (tmp + rename); the anchor is REPLACED rather than max-merged, because a `historyId` is
 * an opaque increasing sequence Google owns and string comparison of two of them means nothing.
 *
 * ## The BACKFILL FLOOR — a third fact, and the one that makes "full history" true rather than lucky
 *
 * A `messages.list` walk is bounded by {@link ./fetch.GMAIL_MAX_PAGES}, so a mailbox larger than that
 * bound cannot be crawled in one pass. The connector used to report reaching the bound as a coverage gap
 * and HOLD the cursor, which is safe and is not progress: the next run asks the same question, walks the
 * same pages and stops in the same place. Stated in `fetch.ts` at the time, and true — "re-running the
 * same window will stop in the same place".
 *
 * The floor is what closes that. An epoch-wide crawl that stops at the ceiling records the OLDEST instant
 * it reached, and the next epoch-wide crawl asks for everything BEFORE that instant instead of starting
 * again at today. Each pass therefore walks a fresh slice and the backfill converges, at ceiling-sized
 * bites, with bronze absorbing the one-day overlap each resume deliberately leaves.
 *
 * It is deliberately NOT part of {@link GmailHistoryAnchor}, and the reason is the first pass: an
 * epoch-wide crawl that hits the ceiling has a gap, a gap withholds the `historyId` anchor, and a floor
 * living inside the anchor would be withheld with it — so the very run that needs to record progress would
 * be the one that could not. Two facts, two records, written on different conditions.
 */
import { readFileSync } from "node:fs";

import { slopweaverHome } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** What the anchor file holds about one mailbox. */
export interface GmailHistoryAnchor {
  /** Gmail's own mailbox sequence id, as of the last committed pass. */
  readonly historyId: string;
  /**
   * Whether this mailbox has ever been crawled from the epoch.
   *
   * Sticky once true. It is what separates an EXPIRED anchor from a first-ever run, which need different
   * recoveries and are otherwise indistinguishable — see the module note.
   */
  readonly fullCrawl: boolean;
  /** When the anchor was last written, for the run summary. */
  readonly anchoredAtIso: string;
}

/**
 * How far back a full-history backfill has reached, when one is part-way through.
 *
 * @internal — the declared shape of `readGmailBackfillFloor`'s return.
 */
export interface GmailBackfillFloor {
  /**
   * The OLDEST instant an epoch-wide crawl has reached. Everything from here FORWARD has been crawled; the
   * next epoch-wide pass asks for what is before it.
   */
  readonly floorIso: string;
  /** When the floor was last moved, for the run summary. */
  readonly recordedAtIso: string;
}

/** The persisted shape, versioned so a later field can be added without guessing at an unversioned file. */
interface GmailHistoryFile {
  readonly version: 1;
  readonly anchor?: GmailHistoryAnchor;
  readonly backfill?: GmailBackfillFloor;
}

/** The whole file, read once so the two records can be rewritten without losing each other. */
function readFile({ home }: { home: string }): { anchor: unknown; backfill: unknown } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(stateHomePaths({ home }).corpus.gmailHistory, "utf8"));
  } catch {
    return { anchor: undefined, backfill: undefined };
  }
  return isRecord(raw)
    ? { anchor: raw["anchor"], backfill: raw["backfill"] }
    : { anchor: undefined, backfill: undefined };
}

/**
 * Read the stored anchor, if any.
 *
 * An ABSENT anchor is the signal that the mailbox has never been crawled — the same shape as
 * {@link ../slack/channelWatermark.readSlackChannelWatermarks}'s absent entry, and for the same reason.
 * Anything unreadable or unrecognised degrades to absent rather than throwing: a corrupt cursor costs one
 * full crawl, which is recoverable, while a throw costs the whole refresh.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the stored anchor, or undefined when the mailbox has never been crawled
 */
export function readGmailHistoryAnchor({ home = slopweaverHome() }: { home?: string } = {}):
  GmailHistoryAnchor | undefined {
  const anchor = readFile({ home }).anchor;
  if (!isRecord(anchor) || typeof anchor["historyId"] !== "string" || anchor["historyId"].length === 0) {
    return undefined;
  }
  const anchoredAtIso = anchor["anchoredAtIso"];
  return {
    anchoredAtIso: typeof anchoredAtIso === "string" ? anchoredAtIso : "",
    fullCrawl: anchor["fullCrawl"] === true,
    historyId: anchor["historyId"],
  };
}

/**
 * When an anchor was taken, as a delta run's summary says it. {@link readGmailHistoryAnchor} reads an anchor
 * whose stored file carried no `anchoredAtIso` as `""`, and that anchor's time was never recorded.
 *
 * @param anchor the stored anchor the run resumed from
 * @returns the instant it was taken, or the words saying it went unrecorded
 */
export function anchorTakenAt({ anchor }: { anchor: GmailHistoryAnchor }): string {
  if (anchor.anchoredAtIso.length === 0) {
    return "at an unrecorded time";
  }
  return anchor.anchoredAtIso;
}

/**
 * Write the mailbox anchor, keeping the full-crawl marker sticky.
 *
 * REPLACES the `historyId` rather than merging it, unlike every `tsIso` cursor in this repository. A
 * `historyId` is an opaque sequence Google owns: `"11542"` sorts after `"9903"` lexically and before it
 * numerically, so a max-merge would be right by accident at best. The caller only ever writes an anchor it
 * has just been handed by the API for a pass it has just committed, so replacement is the honest operation.
 *
 * @param historyId the sequence id to store — Gmail's own, never derived
 * @param fullCrawl whether the pass being committed crawled the mailbox end to end; a `false` never clears
 *   a stored `true`, because a narrow pass has not un-crawled anything
 * @param nowIso when the anchor was taken
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the written path, or the write failure
 */
export function writeGmailHistoryAnchor({
  historyId,
  fullCrawl,
  nowIso,
  home = slopweaverHome(),
}: {
  historyId: string;
  fullCrawl: boolean;
  nowIso: string;
  home?: string;
}): Result<{ path: string }> {
  const path = stateHomePaths({ home }).corpus.gmailHistory;
  const existing = readGmailHistoryAnchor({ home });
  const floor = readGmailBackfillFloor({ home });
  const file: GmailHistoryFile = {
    anchor: {
      anchoredAtIso: nowIso,
      fullCrawl: fullCrawl || existing?.fullCrawl === true,
      historyId,
    },
    // Carried through rather than dropped: this writer is about the anchor, and silently clearing a
    // part-finished backfill would restart it from today the next time an epoch-wide crawl ran.
    ...(floor === undefined ? {} : { backfill: floor }),
    version: 1,
  };
  try {
    writeFileAtomic({ contents: `${JSON.stringify(file, null, 2)}\n`, path });
  } catch (error: unknown) {
    return err([error instanceof Error ? error.message : `failed to write the Gmail history anchor ${path}`]);
  }
  return ok({ path });
}

/**
 * Read how far back a part-finished full-history backfill has reached.
 *
 * Absent means one of two things and the caller distinguishes them from the anchor's `fullCrawl`: either
 * the mailbox has been crawled end to end (nothing left to resume) or no epoch-wide crawl has ever been
 * cut short. Both are "start at today", which is why one absent value serves for both.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the floor, or undefined when no backfill is part-way through
 */
export function readGmailBackfillFloor({ home = slopweaverHome() }: { home?: string } = {}):
  GmailBackfillFloor | undefined {
  const backfill = readFile({ home }).backfill;
  if (!isRecord(backfill) || typeof backfill["floorIso"] !== "string" || backfill["floorIso"].length === 0) {
    return undefined;
  }
  const recordedAtIso = backfill["recordedAtIso"];
  return {
    floorIso: backfill["floorIso"],
    recordedAtIso: typeof recordedAtIso === "string" ? recordedAtIso : "",
  };
}

/**
 * Move — or CLEAR — the backfill floor, leaving the anchor exactly as it stands.
 *
 * Clearing is what an epoch-wide crawl that finished its walk does, and it is as load-bearing as moving:
 * a floor left behind after the backfill converged would make every later epoch-wide crawl ask only for
 * mail older than a date it has already passed, which reads as a working refresh that returns nothing.
 *
 * A floor only ever moves BACKWARD. A pass that somehow reached a newer instant than the stored floor is
 * one that re-crawled ground already covered, and taking its value would UNDO progress — so the older of
 * the two wins, and a backfill cannot walk backwards up its own mailbox.
 *
 * @param floorIso the oldest instant the pass reached, or undefined to clear a converged backfill
 * @param nowIso when the floor was moved
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the written path, or the write failure
 */
export function writeGmailBackfillFloor({
  floorIso,
  nowIso,
  home = slopweaverHome(),
}: {
  floorIso: string | undefined;
  nowIso: string;
  home?: string;
}): Result<{ path: string }> {
  const path = stateHomePaths({ home }).corpus.gmailHistory;
  const anchor = readGmailHistoryAnchor({ home });
  const existing = readGmailBackfillFloor({ home });
  const kept =
    floorIso === undefined
      ? undefined
      : {
          floorIso: existing !== undefined && existing.floorIso < floorIso ? existing.floorIso : floorIso,
          recordedAtIso: nowIso,
        };
  const file: GmailHistoryFile = {
    ...(anchor === undefined ? {} : { anchor }),
    ...(kept === undefined ? {} : { backfill: kept }),
    version: 1,
  };
  try {
    writeFileAtomic({ contents: `${JSON.stringify(file, null, 2)}\n`, path });
  } catch (error: unknown) {
    return err([error instanceof Error ? error.message : `failed to write the Gmail backfill floor ${path}`]);
  }
  return ok({ path });
}
