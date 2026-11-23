/**
 * The two local ledgers `calendar prep-due` reads to tell whether a meeting already has a brief: the meeting-tag
 * ledger (a page tagged to it) and the board (a row claiming its slug). Each is read WHOLE or not at all — a line or
 * doc that will not read fails the read, because it may be the very claim that would have suppressed a duplicate.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";

import { scanBoard } from "../../../handover/store.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { PRIMARY_CALENDAR } from "../../../live/calendar/read.js";
import { currentTags } from "../../../pages/meetingTag.js";
import { readMeetingTags } from "../../../pages/meetingTagStore.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * Every primary-calendar event instance a page is currently tagged to, read from the tag ledger. A line the ledger
 * cannot parse fails the read: it may be the very tag that would have suppressed a duplicate brief.
 *
 * @param home the state home the ledger lives under
 * @returns the ids, or why the ledger could not be trusted — never an empty set in its place
 */
export function readTaggedEventIds({ home }: { home: string }): Result<ReadonlySet<string>, string> {
  const read = readMeetingTags({ home });
  if (read.isErr()) {
    return err(read.error.message);
  }
  if (read.value.unparsed.length > 0) {
    return err(
      `calendar prep-due: the meeting-tag ledger has ${String(read.value.unparsed.length)} line(s) it cannot parse ` +
        `(${read.value.unparsed.join("; ")}), and one may be a tag that would suppress a duplicate brief`,
    );
  }
  return ok(
    new Set(
      currentTags({ tags: read.value.tags })
        .filter((tag) => tag.calendarId === PRIMARY_CALENDAR)
        .map((tag) => tag.eventId),
    ),
  );
}

/**
 * Every slug a row already claims, read whole. A doc's FILENAME is not the whole claim: an archived doc can carry a
 * slug its filename does not (3 of 389, `registerWrite.ts`'s `archivedClaimant`), and `handover register` without
 * `--tag` checks only the filename it is about to create. So both directories are parsed for their
 * declared slugs, and a doc that will not read fails the read — it may be the very row.
 *
 * @param home the state home the board and its journals live under
 * @returns the claimed slugs, or why the board could not be read whole — never a partial set in its place
 */
export function readClaimedSlugs({ home }: { home: string }): Result<ReadonlySet<string>, string> {
  const paths = stateHomePaths({ home });
  const claimed = new Set<string>();
  for (const handoverDir of [paths.handovers, paths.handoverArchive]) {
    const scan = scanBoard({ handoverDir });
    if (scan.isErr()) {
      return err(`calendar prep-due: cannot read ${handoverDir}: ${scan.error.message}`);
    }
    if (scan.value.unreadable.length > 0) {
      return err(
        `calendar prep-due: ${String(scan.value.unreadable.length)} doc(s) in ${handoverDir} will not read ` +
          `(${scan.value.unreadable.join(", ")}), and one may already claim a meeting's row`,
      );
    }
    for (const doc of scan.value.docs) {
      claimed.add(doc.slug);
      claimed.add(basename(doc.path, ".md"));
    }
  }
  if (existsSync(paths.runs)) {
    for (const name of readdirSync(paths.runs).filter((each) => each.endsWith(".jsonl"))) {
      claimed.add(basename(name, ".jsonl"));
    }
  }
  return ok(claimed);
}
