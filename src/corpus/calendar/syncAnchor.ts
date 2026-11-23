/**
 * The `calendar` source's delta cursor — one Google `syncToken` per calendar, under
 * `$SLOPWEAVER_HOME/corpus/watermarks/calendar-sync.json`.
 *
 * ## Why this is a SECOND cursor layer, beside the pooled watermark
 *
 * The pooled watermark (`../watermark.ts`) answers "how far through time has this source been read". A sync
 * token answers a different question: "what has CHANGED since Google last served me everything". They are
 * not interchangeable, because an event edited today can move a meeting that happened last month — a
 * time-ordered cursor would never see it, and a delta cursor sees it immediately. Calendar is the second
 * source here with a real change feed, and the mail door's `historyId` anchor is the shape this follows.
 *
 * ## One token PER CALENDAR, and it cannot be otherwise
 *
 * Google mints a sync token against one `calendarId` and one exact parameter set. A token from `primary` is
 * meaningless on a team calendar, so the store is a map rather than a single value, and a calendar with no
 * entry simply takes the window lane on its next pass.
 *
 * ## The parameter fingerprint, and why a token is dropped rather than reused
 *
 * Google's own contract is that an incremental request must repeat the parameters its token was minted
 * under, and that results are UNDEFINED if they change. Undefined is worse than an error: it is silently
 * wrong data. So each stored token carries the fingerprint of the parameters that produced it, and a token
 * whose fingerprint no longer matches is discarded rather than sent — the next pass re-crawls by window and
 * re-anchors, which costs one crawl and can never produce a corpus that is quietly missing events.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";

/** The stored delta cursor for ONE calendar. */
export interface CalendarSyncAnchor {
  /** Google's own `nextSyncToken` from the last complete listing. */
  readonly syncToken: string;
  /**
   * A digest of the request parameters this token was minted under.
   *
   * Compared before the token is ever sent. Google says results are undefined when the parameters change,
   * and a silently-wrong result is the one outcome no later check could detect.
   */
  readonly parameterFingerprint: string;
  /** When the token was recorded, ISO-8601 — so an operator can see how old a delta lane's basis is. */
  readonly recordedAtIso: string;
}

/** Every calendar's anchor, keyed by the id the API addresses it by. */
export type CalendarSyncAnchors = Readonly<Record<string, CalendarSyncAnchor>>;

/**
 * The path the anchors are written to for a given home.
 *
 * @param home the Slopweaver home
 * @returns the absolute path of the anchor file
 */
export function calendarSyncAnchorPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).corpus.root, "watermarks", "calendar-sync.json");
}

/** Narrow one unknown parsed entry to a {@link CalendarSyncAnchor}. */
function isAnchor(value: unknown): value is CalendarSyncAnchor {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["syncToken"] === "string" &&
    typeof value["parameterFingerprint"] === "string" &&
    typeof value["recordedAtIso"] === "string"
  );
}

/**
 * Read every stored anchor back.
 *
 * A missing file is an EMPTY map rather than an error, because "never anchored" is the ordinary state of a
 * fresh install and of every calendar the first pass has not reached. A file that exists and will not parse
 * is also empty rather than an error, and that is the deliberate half: the recovery for a corrupt cursor is
 * to re-crawl by window, which is exactly what an empty map produces, so failing the whole refresh over it
 * would turn a self-healing case into a stall.
 *
 * @param home the Slopweaver home
 * @returns each calendar's anchor, empty when none is stored or the file is unreadable
 */
export function readCalendarSyncAnchors({ home }: { home: string }): CalendarSyncAnchors {
  let raw: string;
  try {
    raw = readFileSync(calendarSyncAnchorPath({ home }), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) {
    return {};
  }
  const anchors: Record<string, CalendarSyncAnchor> = {};
  for (const [calendarId, value] of Object.entries(parsed)) {
    if (isAnchor(value)) {
      anchors[calendarId] = value;
    }
  }
  return anchors;
}

/**
 * Write the anchors back, replacing the whole file.
 *
 * @param home the Slopweaver home
 * @param anchors every calendar's anchor, as it should stand after this run
 * @returns the path written, or the reason the write failed
 */
export function writeCalendarSyncAnchor({
  home,
  anchors,
}: {
  home: string;
  anchors: CalendarSyncAnchors;
}): Result<string> {
  const path = calendarSyncAnchorPath({ home });
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(anchors, undefined, 2)}\n`);
  } catch (error: unknown) {
    return err([`could not write the calendar sync anchors: ${errorMessage({ error })}`]);
  }
  return ok(path);
}

/**
 * The token to resume ONE calendar from, or undefined when it must be crawled by window.
 *
 * Undefined for three distinct reasons, and the caller does not need to tell them apart: nothing was ever
 * anchored, the caller overrode the cursor with an explicit window, or the stored token was minted under
 * different parameters and is therefore unusable.
 *
 * @param anchors every stored anchor
 * @param calendarId the calendar being read
 * @param fingerprint the fingerprint of the parameters this run would send
 * @returns the resumable token, or undefined when this calendar takes the window lane
 */
export function resumableToken({
  anchors,
  calendarId,
  fingerprint,
}: {
  anchors: CalendarSyncAnchors;
  calendarId: string;
  fingerprint: string;
}): string | undefined {
  const anchor = anchors[calendarId];
  if (anchor === undefined || anchor.parameterFingerprint !== fingerprint) {
    return undefined;
  }
  return anchor.syncToken;
}
