/**
 * Where a held calendar write waits between the preview and the owner's approval: one JSON file per
 * intent under `$SLOPWEAVER_HOME/calendar/intents/`, owner-only, written atomically.
 *
 * ## Why a file and not the diary
 *
 * A held booking cannot live on Google — creating it there is the outward act the hold exists to prevent
 * (`writePlan.ts` header). So the intent is local: the form, the target, and for an existing event the
 * snapshot and ETag the digest was computed over. `commit` re-reads Google and rebuilds the digest from the
 * stored form against the CURRENT event, so a stale snapshot is detected as drift rather than replayed.
 *
 * ## One performance per intent
 *
 * `markApplied` flips the file's `state`, and `read` of a spent intent is refused by the caller by that
 * state, so a second `commit` of the same id cannot mint a second invite. The file is never deleted by the
 * verbs: an applied intent is the receipt of what was sent, and a `uncertain` one is the record a lost
 * response leaves behind for reconciliation by event id.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { CalendarIntent } from "./writePlan.js";

/**
 * Where a home keeps its pending and spent calendar intents.
 *
 * Derived by `stateHomePaths`, never by a `join` here: the home layout has one owner, so a directory this
 * module invented would be invisible to everything that enumerates or migrates a home.
 *
 * @internal — exported so a test asserts the path against the function rather than re-deriving it.
 *
 * @param home the state home
 * @returns the absolute directory path
 */
export function calendarIntentsDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).calendarIntents;
}

/** The file one intent lives in. Ids are UUID hex, so the name needs no escaping. */
function intentPath({ home, intentId }: { home: string; intentId: string }): string {
  return join(calendarIntentsDir({ home }), `${intentId}.json`);
}

/** Narrow one parsed document to a {@link CalendarIntent} by its load-bearing fields. */
function isIntent(value: unknown): value is CalendarIntent {
  if (!isRecord(value)) {
    return false;
  }
  const form = value["form"];
  return (
    value["version"] === 1 &&
    typeof value["intentId"] === "string" &&
    typeof value["createdAtIso"] === "string" &&
    typeof value["account"] === "string" &&
    typeof value["calendarId"] === "string" &&
    typeof value["eventId"] === "string" &&
    isRecord(form) &&
    typeof form["kind"] === "string" &&
    (value["previewDigest"] === undefined || typeof value["previewDigest"] === "string") &&
    (value["state"] === "pending" || value["state"] === "applied" || value["state"] === "uncertain")
  );
}

/**
 * Write an intent, replacing any file already under its id.
 *
 * @param home the state home
 * @param intent the intent as it should stand
 * @returns the path written, or the reason the write failed
 */
export function writeCalendarIntent({ home, intent }: { home: string; intent: CalendarIntent }): Result<string> {
  const path = intentPath({ home, intentId: intent.intentId });
  try {
    mkdirSync(calendarIntentsDir({ home }), { mode: 0o700, recursive: true });
    writeFileAtomic({ contents: `${JSON.stringify(intent, undefined, 2)}\n`, dirMode: 0o700, fileMode: 0o600, path });
    return ok(path);
  } catch (cause) {
    return err([`could not write calendar intent ${intent.intentId}: ${errorMessage({ error: cause })}`]);
  }
}

/**
 * Read one intent back, whatever its state.
 *
 * @param home the state home
 * @param intentId the id `book`/`edit`/`reschedule`/`cancel`/`respond` printed
 * @returns the intent, undefined when none is stored under that id, or the reason the file could not be read
 */
export function readCalendarIntent({
  home,
  intentId,
}: {
  home: string;
  intentId: string;
}): Result<CalendarIntent | undefined> {
  let raw: string;
  try {
    raw = readFileSync(intentPath({ home, intentId }), "utf8");
  } catch (cause) {
    const code = isRecord(cause) ? cause["code"] : undefined;
    return code === "ENOENT"
      ? ok(undefined)
      : err([`could not read calendar intent ${intentId}: ${errorMessage({ error: cause })}`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return err([`calendar intent ${intentId} is not valid JSON: ${errorMessage({ error: cause })}`]);
  }
  return isIntent(parsed) ? ok(parsed) : err([`calendar intent ${intentId} does not have the shape this door writes`]);
}
