/**
 * WHEN THE OWNER PRESSED DONE — the instant a `done` marker's settle is stamped at, read off the marker itself.
 *
 * Its own module because the reconcile that consumes it is a sequence of arms, and this is the one judgement
 * inside it about time: the settle is the press, never the pass that noticed it.
 */
import { readFileSync, statSync } from "node:fs";

import { err, ok, type Result } from "../lib/result.js";
import { type HandStepError, HandStepErrors } from "./errors.js";

/**
 * What a `done` marker's stamp says the owner did, and when.
 *
 * The note writes the instant it was pressed, which is exactly the honest thing to record: nothing else
 * knows what the owner typed into which console, and inventing a sentence would put words in their mouth on a row
 * that reads as theirs. The settle is stamped at the PRESS, not at this reconcile: a recipe that ran between the
 * two is after the owner's close, and a reconcile-time stamp read it as before and held a new stop off the Queue.
 * A stamp that will not read as a date settles at the marker file's own write time,
 * which is the press too. With neither readable, or both later than now, there is no press
 * instant to settle at, and settling at now would read a run after the press as before it: the press is refused, its
 * marker stays, and the card stays open — loud — until a later pass can read it.
 *
 * @param stamp the marker's trimmed bytes, empty when it carried none or would not read
 * @param writtenIso when the marker file was written, or null when it would not stat
 * @param nowIso this reconcile's instant
 * @returns the line the register records and the instant it settles at, or why no press instant reads
 */
export function donePressSettle({
  stamp,
  writtenIso,
  nowIso,
}: {
  stamp: string;
  writtenIso: string | null;
  nowIso: string;
}): Result<{ did: string; settledIso: string }, HandStepError> {
  let did = "the owner pressed Done on the note";
  if (stamp.length > 0) {
    did = `the owner pressed Done on the note (${stamp})`;
  }
  const nowMs = Date.parse(nowIso);
  for (const candidate of [stamp, writtenIso]) {
    if (candidate === null || candidate.length === 0) {
      continue;
    }
    const pressedMs = Date.parse(candidate);
    if (!Number.isNaN(pressedMs) && pressedMs <= nowMs) {
      return ok({ did, settledIso: new Date(pressedMs).toISOString() });
    }
  }
  return err(
    HandStepErrors.invalidField({
      field: "a Done marker's press instant",
      why: "reads from neither its stamp nor its file's write time at or before now, so it stays for a later pass",
    }),
  );
}

/**
 * The settle one `done` marker file makes, read off its bytes and its write time.
 *
 * @param path the marker file
 * @param nowIso this reconcile's instant
 * @returns what {@link donePressSettle} answers for that file
 */
export function donePressSettleAt({
  path,
  nowIso,
}: {
  path: string;
  nowIso: string;
}): Result<{ did: string; settledIso: string }, HandStepError> {
  return donePressSettle({ nowIso, stamp: markerStamp({ path }), writtenIso: markerWrittenIso({ path }) });
}

/**
 * A `done` marker's own bytes, trimmed, or empty when the file will not read.
 *
 * @param path the marker file
 * @returns the stamp
 */
function markerStamp({ path }: { path: string }): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * When a `done` marker file was last written, or null when it will not stat.
 *
 * @param path the marker file
 * @returns the instant
 */
function markerWrittenIso({ path }: { path: string }): string | null {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}
