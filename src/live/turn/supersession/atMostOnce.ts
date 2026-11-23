/**
 * The at-most-once question, asked of the journal this shell already writes.
 *
 * Its own module because it is the one check that reads STATE THIS PROGRAM WROTE rather than state Slack or
 * the reviewer reports, and `./run.ts` is a shell over seams that decides nothing. Keeping it here also
 * keeps the read and the fold it depends on in one place: a future caller wanting the same guarantee asks
 * this function rather than re-deriving which of the two row kinds settles it.
 */
import { type SupersessionError, SupersessionErrors } from "./errors.js";
import type { SupersessionAttempt } from "./journal.js";

/**
 * Everything that makes one journal read untrustworthy FOR THIS GUARD, as one sentence or `undefined`.
 *
 * Two inputs rather than one, because `./store.ts` reports two different tolerances and only the audit can
 * use them. A failed OPEN says nothing was read; an unparseable LINE says something was there and could not
 * be understood, and the guard has to treat the second as it treats the first — the row it skipped may be
 * the very intent it is looking for. MEASURED: a torn tail turned one
 * intent row into an unparseable line, that line was dropped, and a repeated correction deleted twice.
 *
 * @param readFailure what opening the journal failed with, when it exists and could not be opened
 * @param unreadable the 1-indexed lines the reader could not parse
 * @returns the reason the read cannot be trusted, and `undefined` when every line of it was understood
 */
export function journalReadFailure({
  readFailure,
  unreadable,
}: {
  readFailure: string | undefined;
  unreadable: readonly number[];
}): string | undefined {
  if (readFailure !== undefined) {
    return readFailure;
  }
  if (unreadable.length === 0) {
    return undefined;
  }
  return (
    `line(s) ${unreadable.join(", ")} could not be parsed, and one of them may be the intent row that ` +
    "names this pair"
  );
}

/**
 * Has this exact (turn, target) pair already journalled an INTENT to delete?
 *
 * Judged on the intent, never on the result: the two-row shape exists precisely so a session that died
 * between them is visible, and that gap is the case where a second attempt is least safe rather than most.
 * Correlated on both ids together, because one turn may legitimately supersede a different message later
 * and keying on the turn alone would refuse it.
 *
 * **A journal that could not be read refuses rather than reading as empty**, which is the whole reason
 * `./store.ts` reports its read failure instead of catching it. An empty list means "this install has never
 * superseded anything", and a failed open means "we cannot tell" — collapsing the second into the first is
 * how an irreversible act runs twice (`./store.ts`'s own note carries the measurement).
 *
 * @param attempts every attempt the journal holds, already folded per pair by `./journal.ts`
 * @param readFailure what reading the journal failed with, when it exists and could not be opened
 * @returns the refusal when an intent is already on the record or the journal is unreadable, and
 *   `undefined` when this is the first ask
 */
export function alreadyAttempted({
  attempts,
  readFailure,
  targetTs,
  turnId,
}: {
  attempts: readonly SupersessionAttempt[];
  readFailure: string | undefined;
  targetTs: string;
  turnId: string;
}): SupersessionError | undefined {
  if (readFailure !== undefined) {
    return SupersessionErrors.journalUnreadable({ cause: readFailure, ts: targetTs });
  }
  const already = attempts.find(
    (attempt) => attempt.turnId === turnId && attempt.targetTs === targetTs && attempt.intent !== undefined,
  );
  if (already === undefined) {
    return undefined;
  }
  return SupersessionErrors.alreadyAttempted({ intendedIso: already.intent!.tsIso, ts: targetTs });
}
