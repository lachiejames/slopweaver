/**
 * What a correction turn SET OUT to delete, and what became of it — the supersession journal's pure half.
 *
 * ## Two rows, and why one would not do
 *
 * An INTENT row is written before the delete and a RESULT row after it. One row written afterwards would be
 * cheaper and would lose the only question an audit actually asks: a session that died mid-delete leaves no
 * row at all under a one-row scheme, which is indistinguishable from a turn that never tried. Under two, an
 * intent with no result is a crash, and it is visible as one — the same reason `../../../admit/effects.ts`
 * records its decision BEFORE performing rather than after.
 *
 * ## The code vocabulary is CLOSED
 *
 * `outcome` is one of a fixed set, and a refusal carries the `SupersessionError`/`OwnedDeleteError` code
 * verbatim rather than a sentence. A journal whose values are prose is one nobody can query, and the
 * question an auditor brings to this file — "how often does a correction refuse on FOREIGN_THREAD" — is a
 * count over codes. The human sentence rides beside it in `detail` for a reader, never instead of it.
 *
 * Nothing here writes: `./store.ts` is the effectful edge, and everything in this module is a value.
 */

/** The journal's schema version. Bumped when a row's SHAPE changes, never when a code is added. */
const SUPERSESSION_SCHEMA_VERSION = 1;

/** What a supersession attempt ended as. A closed set, so a reader can count rather than grep. */
export type SupersessionOutcome =
  /** The superseded answer was removed. */
  | "deleted"
  /** It was already gone when the delete ran — somebody, or an earlier attempt, had removed it. */
  | "already-gone"
  /** A check said no. `code` names which. */
  | "refused"
  /** The delete was attempted and did not confirm — the message may or may not still be visible. */
  | "unconfirmed";

/** The intent row: this correction is about to try to delete the answer it supersedes. */
export interface SupersessionIntent {
  readonly kind: "supersession-intended";
  readonly schemaVersion: number;
  readonly tsIso: string;
  /** The turn doing the superseding. */
  readonly turnId: string;
  readonly channel: string;
  readonly threadTs: string;
  /** The answer this turn just posted, so a reader can see both messages. */
  readonly answerTs: string;
  /** The message about to be deleted. */
  readonly targetTs: string;
  /** The turn that posted the target. */
  readonly supersededTurnId: string;
  /** The reviewer's stated reason the delete is warranted. */
  readonly reason: string;
}

/** The result row: what the attempt in the matching intent actually did. */
export interface SupersessionResult {
  readonly kind: "supersession-settled";
  readonly schemaVersion: number;
  readonly tsIso: string;
  readonly turnId: string;
  readonly targetTs: string;
  readonly outcome: SupersessionOutcome;
  /** The domain code, for a `refused` or `unconfirmed` row. Absent when the delete simply worked. */
  readonly code?: string | undefined;
  /** One human sentence beside the code — never instead of it. */
  readonly detail?: string | undefined;
}

/** One row in the supersession journal. */
export type SupersessionEvent = SupersessionIntent | SupersessionResult;

/**
 * One journal row as the exact JSON line the store appends.
 *
 * @param event the row to serialise
 * @returns the line, with no trailing newline
 */
export function supersessionEventLine({ event }: { event: SupersessionEvent }): string {
  return JSON.stringify(event);
}

/**
 * Build the INTENT row for one eligible supersession.
 *
 * @param turnId the turn doing the superseding
 * @param channel where both messages stand
 * @param threadTs the thread that bounds the whole act
 * @param answerTs the correction this turn just posted
 * @param targetTs the answer about to be removed
 * @param supersededTurnId the turn that posted the target
 * @param reason the reviewer's stated warrant
 * @param tsIso the instant, injected so a test can assert it
 * @returns the row
 */
export function supersessionIntent({
  turnId,
  channel,
  threadTs,
  answerTs,
  targetTs,
  supersededTurnId,
  reason,
  tsIso,
}: {
  turnId: string;
  channel: string;
  threadTs: string;
  answerTs: string;
  targetTs: string;
  supersededTurnId: string;
  reason: string;
  tsIso: string;
}): SupersessionIntent {
  return {
    answerTs,
    channel,
    kind: "supersession-intended",
    reason,
    schemaVersion: SUPERSESSION_SCHEMA_VERSION,
    supersededTurnId,
    targetTs,
    threadTs,
    tsIso,
    turnId,
  };
}

/**
 * Build the RESULT row that settles one intent.
 *
 * @param turnId the turn whose intent this settles
 * @param targetTs the message the intent named
 * @param outcome what the attempt ended as
 * @param code the domain code behind a refusal or an unconfirmed delete
 * @param detail one human sentence beside the code
 * @param tsIso the instant, injected so a test can assert it
 * @returns the row
 */
export function supersessionSettled({
  turnId,
  targetTs,
  outcome,
  code,
  detail,
  tsIso,
}: {
  turnId: string;
  targetTs: string;
  outcome: SupersessionOutcome;
  code?: string | undefined;
  detail?: string | undefined;
  tsIso: string;
}): SupersessionResult {
  return {
    kind: "supersession-settled",
    outcome,
    schemaVersion: SUPERSESSION_SCHEMA_VERSION,
    targetTs,
    tsIso,
    turnId,
    ...(code === undefined ? {} : { code }),
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * One (turn, target) pair as the journal records it — BOTH halves optional, and each absence means something.
 *
 * An intent with no result is a session that died between the door and the answer, which is the fact the
 * two-row shape exists to expose. A result with no intent is a supersession refused before any delete was
 * attempted: an intent says "about to delete", and a check that said no never reached that point, so
 * inventing one to pair with would record an attempt that did not happen.
 */
export interface SupersessionAttempt {
  readonly turnId: string;
  readonly targetTs: string;
  /** The row written before the delete, absent on a refusal that never reached one. */
  readonly intent: SupersessionIntent | undefined;
  /** The row that settled it, absent when the session died mid-delete. */
  readonly settled: SupersessionResult | undefined;
}

/** The `<turnId>\u0000<targetTs>` key one attempt is correlated under — NUL-joined so no id can forge a pair. */
function attemptKey({ turnId, targetTs }: { turnId: string; targetTs: string }): string {
  return `${turnId}\u0000${targetTs}`;
}

/**
 * Fold the journal's rows into one entry per (turn, target), in the order each pair is first seen.
 *
 * Correlated on `turnId` AND `targetTs` together: a turn supersedes at most one answer today, but keying on
 * the turn alone would silently pair the wrong rows the day that stops being true, and a mispaired audit row
 * about an irreversible act is worse than an unpaired one.
 *
 * @param events every row read out of the journal, in file order
 * @returns one entry per (turn, target) pair, each carrying whichever halves the journal holds
 */
export function supersessionAttempts({
  events,
}: {
  events: readonly SupersessionEvent[];
}): readonly SupersessionAttempt[] {
  const byKey = new Map<
    string,
    { turnId: string; targetTs: string; intent?: SupersessionIntent; settled?: SupersessionResult }
  >();
  for (const event of events) {
    const key = attemptKey({ targetTs: event.targetTs, turnId: event.turnId });
    // `has` then `get`, rather than the `??=` or ternary a reader might reach for first: `no-silent-fallback`
    // bans the operator, `prefer-nullish-coalescing` bans the ternary, and the two arms were never a default
    // anyway — one is the attempt this journal already holds a half of, the other is its first row. The
    // entry is then mutated in place, so the map holds the same object either way.
    if (!byKey.has(key)) {
      byKey.set(key, { targetTs: event.targetTs, turnId: event.turnId });
    }
    const entry = byKey.get(key)!;
    if (event.kind === "supersession-intended") {
      entry.intent = event;
    } else {
      entry.settled = event;
    }
  }
  return [...byKey.values()].map((entry) => ({
    intent: entry.intent,
    settled: entry.settled,
    targetTs: entry.targetTs,
    turnId: entry.turnId,
  }));
}
