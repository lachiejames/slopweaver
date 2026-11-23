/**
 * The push lane's own ledger — what was outstanding the last time it looked, so nothing is ever pushed twice.
 *
 * One append-only `hand-steps/pushed.jsonl` under the state home. A row is written only when the outstanding
 * set MOVED, in either direction, which is what keeps the file small under a scheduled caller while still
 * letting a subject that departs and comes back push again.
 *
 * Recording a departure matters as much as recording an arrival, and it is the half that is easy to miss: if
 * only sends were recorded, a step the owner cleared would stay in the "already pushed" set forever, and the same
 * step posted again next week would arrive silently.
 */
import { mkdirSync, statSync } from "node:fs";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";
import { type HandStepError, HandStepErrors } from "../errors.js";
import type { PushedBefore } from "./select.js";

/** Owner-only permissions, matching the register beside it. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** One recorded pass of the lane. */
export interface PushLedgerRow {
  /** Every subject id outstanding at that instant — the set the NEXT pass is judged against. */
  readonly outstanding: readonly string[];
  /** Whether a banner actually went out, so a reader can tell a send from a bookkeeping row. */
  readonly sent: boolean;
  readonly atIso: string;
}

/**
 * Read the set the last recorded pass saw.
 *
 * An absent ledger is an empty set, which makes the first pass on a fresh install push everything
 * outstanding exactly once — the correct behaviour, and the reason this read does not refuse on absence the
 * way the step register's does. A ledger that is present but unreadable DOES refuse, because treating it as
 * empty would re-push everything the owner has already been told about.
 *
 * @param home the state home
 * @returns the ids, or the failure
 */
export function readPushedBefore({ home }: { home: string }): Result<PushedBefore, HandStepError> {
  const path = stateHomePaths({ home }).handPushedJsonl;
  try {
    statSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok({ ids: [] });
    }
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error }), path }));
  }
  let last: readonly string[] = [];
  let corrupt: HandStepError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (corrupt !== undefined || line.trim().length === 0) {
          return;
        }
        const row = parsePushRow({ line, lineNumber: index + 1 });
        if (row.isErr()) {
          corrupt = row.error;
          return;
        }
        last = row.value.outstanding;
      },
      path,
    });
  } catch (cause) {
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  if (corrupt !== undefined) {
    return err(corrupt);
  }
  return ok({ ids: last });
}

/**
 * Parse one ledger line.
 *
 * @param line the raw line
 * @param lineNumber which line it was, for the refusal
 * @returns the row, or why the line is not one
 */
export function parsePushRow({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<PushLedgerRow, HandStepError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return err(HandStepErrors.corruptRow({ lineNumber, why: "it is not JSON" }));
  }
  if (!isRecord(parsed)) {
    return err(HandStepErrors.corruptRow({ lineNumber, why: "it is not a JSON object" }));
  }
  const outstanding = parsed["outstanding"];
  const atIso = parsed["atIso"];
  const sent = parsed["sent"];
  if (!Array.isArray(outstanding) || typeof atIso !== "string" || typeof sent !== "boolean") {
    return err(
      HandStepErrors.corruptRow({
        lineNumber,
        why: "a push row carries an `outstanding` array, an `atIso` string and a `sent` boolean",
      }),
    );
  }
  const ids = outstanding.filter((id): id is string => typeof id === "string");
  if (ids.length !== outstanding.length) {
    return err(HandStepErrors.corruptRow({ lineNumber, why: "a push row's `outstanding` holds only strings" }));
  }
  return ok({ atIso, outstanding: ids, sent });
}

/**
 * Record one pass.
 *
 * @param row what was outstanding and whether a banner went out
 * @param home the state home
 * @returns the ledger's path, or the failure
 */
export function appendPushRow({ row, home }: { row: PushLedgerRow; home: string }): Result<string, HandStepError> {
  const paths = stateHomePaths({ home });
  const path = paths.handPushedJsonl;
  const detached = { ...row };
  Object.setPrototypeOf(detached, null);
  try {
    mkdirSync(paths.handSteps, { mode: DIR_MODE, recursive: true });
    appendLines({
      mode: FILE_MODE,
      path,
      text: `${safeJsonStringify({ label: "a push ledger row", value: detached })}\n`,
    });
  } catch (cause) {
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok(path);
}

/**
 * Record that one subject left what the owner has been told about, without waiting for the next pass to see it go.
 *
 * A snooze is the caller: it takes a step out of the outstanding set for a while, and the lane only learns of a
 * departure by running while it is away. A snooze that lapses with no pass in between would otherwise read as
 * "still outstanding, already told", and its return would never be an arrival. A subject the last pass did not
 * carry needs no row, so a repeated call writes nothing.
 *
 * @param subjectId the ledger id leaving, `hand:<id>` for a step
 * @param atIso when it left
 * @returns whether a row was written, or the failure to read or append
 */
export function departPushedSubject({
  home,
  subjectId,
  atIso,
}: {
  home: string;
  subjectId: string;
  atIso: string;
}): Result<boolean, HandStepError> {
  const before = readPushedBefore({ home });
  if (before.isErr()) {
    return err(before.error);
  }
  if (!before.value.ids.includes(subjectId)) {
    return ok(false);
  }
  const outstanding = before.value.ids.filter((id) => id !== subjectId);
  return appendPushRow({ home, row: { atIso, outstanding, sent: false } }).map(() => true);
}
