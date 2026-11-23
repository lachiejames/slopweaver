/**
 * The tag ledger on disk: `$SLOPWEAVER_HOME/page-meetings.jsonl`, one {@link MeetingTag} per line, append-only.
 *
 * Append-only because a re-tag is a fact about when the meeting was last read, and the last row per slug is the
 * current one (`./meetingTag.ts`'s `currentTags`). The effectful edge of `./meetingTag.ts`.
 */
import { existsSync } from "node:fs";

import { appendLines } from "#lib/appendSeparator.js";
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { type MeetingTag, type MeetingTagError, MeetingTagErrors, parseMeetingTagLine } from "./meetingTag.js";

/** Owner read/write only: a meeting's title and time are the owner's. */
const LEDGER_MODE = 0o600;

/** Every tag the ledger holds, and every line it could not read as one. */
export interface MeetingTagRead {
  readonly tags: readonly MeetingTag[];
  /** One problem per line that is not a tag, naming its line number. */
  readonly unparsed: readonly string[];
}

/**
 * Append one tag to the ledger.
 *
 * @param home the state home the ledger lives under
 * @param tag the tag to record
 * @returns the ledger's path, or why the append failed
 */
export function appendMeetingTag({ home, tag }: { home: string; tag: MeetingTag }): Result<string, MeetingTagError> {
  const path = stateHomePaths({ home }).pageMeetings;
  try {
    appendLines({ durable: true, mode: LEDGER_MODE, path, text: `${JSON.stringify(tag)}\n` });
  } catch (cause) {
    return err(MeetingTagErrors.ledgerUnwritable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok(path);
}

/**
 * Read every tag. A ledger that is not there holds none — nothing was ever tagged — while one that cannot be read is
 * a failure, never an empty answer.
 *
 * @param home the state home the ledger lives under
 * @returns the tags and the lines that were not tags, or why the ledger could not be read
 */
export function readMeetingTags({ home }: { home: string }): Result<MeetingTagRead, MeetingTagError> {
  const path = stateHomePaths({ home }).pageMeetings;
  if (!existsSync(path)) {
    return ok({ tags: [], unparsed: [] });
  }
  const tags: MeetingTag[] = [];
  const unparsed: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        const tag = parseMeetingTagLine({ line });
        if (tag.isErr()) {
          unparsed.push(`line ${String(index + 1)}: ${tag.error.message}`);
          return;
        }
        tags.push(tag.value);
      },
      path,
    });
  } catch (cause) {
    return err(MeetingTagErrors.ledgerUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok({ tags, unparsed });
}
