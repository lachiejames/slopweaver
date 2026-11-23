/**
 * The `outlook-calendar` source's incremental cursor — one modified-time watermark per calendar, under
 * `$SLOPWEAVER_HOME/corpus/watermarks/outlook-calendar-sync.json`.
 *
 * A SECOND cursor layer beside the pooled watermark, for the reason the Google lane's sync tokens are
 * (`../calendar/syncAnchor.ts`): the pooled cursor answers how far through TIME a source was read, and an
 * event edited today can move a meeting from last month. Graph v1.0 offers no unbounded change token for
 * events, so the cursor here is the instant a COMPLETE pass began reading each calendar, which every later
 * `lastModifiedDateTime` filter starts from (`./fetch.ts` says why, and what that leaves out).
 *
 * A missing or unreadable file is an EMPTY map, never an error: the recovery for a lost cursor is a full
 * read of every calendar, which is exactly what an empty map produces, and every record it re-reads dedups.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** The stored cursor for ONE calendar. */
export interface OutlookCalendarSyncAnchor {
  readonly version: 1;
  /** The instant a complete pass began reading this calendar: every edit before it has been read. */
  readonly modifiedThroughIso: string;
  /** When the anchor was written, so an operator can see how old an incremental lane's basis is. */
  readonly recordedAtIso: string;
}

/** Every calendar's anchor, keyed by the calendar id the listing printed. */
export type OutlookCalendarSyncAnchors = Readonly<Record<string, OutlookCalendarSyncAnchor>>;

/**
 * The path the anchors are written to for a given home.
 *
 * @returns the absolute path of the anchor file
 */
export function outlookCalendarSyncAnchorPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).corpus.root, "watermarks", "outlook-calendar-sync.json");
}

/** Narrow one parsed entry to an anchor. */
function isAnchor(value: unknown): value is OutlookCalendarSyncAnchor {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value["version"] === 1 &&
    typeof value["modifiedThroughIso"] === "string" &&
    typeof value["recordedAtIso"] === "string"
  );
}

/**
 * Read every stored anchor back, empty when none is stored or the file will not parse.
 *
 * @returns each calendar's anchor
 */
export function readOutlookCalendarSyncAnchors({ home }: { home: string }): OutlookCalendarSyncAnchors {
  let raw: string;
  try {
    raw = readFileSync(outlookCalendarSyncAnchorPath({ home }), "utf8");
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
  const anchors: Record<string, OutlookCalendarSyncAnchor> = {};
  for (const [calendarId, value] of Object.entries(parsed)) {
    if (isAnchor(value)) {
      anchors[calendarId] = value;
    }
  }
  return anchors;
}

/**
 * Write the anchors back atomically, replacing the whole file.
 *
 * @param anchors every calendar's anchor, as it should stand after this run
 * @returns the path written, or why the write failed
 */
export function writeOutlookCalendarSyncAnchors({
  home,
  anchors,
}: {
  home: string;
  anchors: OutlookCalendarSyncAnchors;
}): Result<string> {
  const path = outlookCalendarSyncAnchorPath({ home });
  try {
    writeFileAtomic({ contents: `${JSON.stringify(anchors, undefined, 2)}\n`, path });
  } catch (error: unknown) {
    return err([`could not write the Outlook calendar sync anchors: ${errorMessage({ error })}`]);
  }
  return ok(path);
}
