/**
 * Why a correction turn did NOT delete the answer it declared it supersedes.
 *
 * Its own union rather than a boolean, and its own union rather than `../errors.ts`'s, because every arm
 * here is a distinct thing to have found out and each is journalled under its own `code` for a reader who
 * is auditing an irreversible act months later. "It did not delete" is the one fact a boolean carries, and
 * it is the only fact that does not matter: a refusal because the target belongs to a DIFFERENT THREAD is a
 * near miss worth investigating, and a refusal because the target was already gone is routine.
 *
 * ## The default is refusal, and the arms say so
 *
 * Every check below is written so that the ABSENCE of evidence refuses. A completion row this installation
 * cannot find, a live message with no `thread_ts`, a review verdict that does not exist — each is an arm
 * here rather than a reason to proceed. That asymmetry is deliberate and it is the whole safety argument:
 * a failure to delete leaves a superseded answer standing, which is the state the thread was already in,
 * while a wrong delete removes a message nobody can restore.
 */

/** The answer form named no `supersedes`, so there is nothing to act on. Not a failure — the ordinary case. */
export interface NothingDeclaredError {
  readonly code: "NOTHING_DECLARED";
  readonly message: string;
}

/** The declared target is the answer this very turn just posted. */
export interface SelfTargetError {
  readonly code: "SELF_TARGET";
  readonly message: string;
  readonly ts: string;
}

/** No review verdict carries a supersession judgement, so no reviewer ever looked at this delete. */
export interface UnreviewedError {
  readonly code: "UNREVIEWED";
  readonly message: string;
  readonly ts: string;
}

/** A reviewer judged a supersession, but of a DIFFERENT message than the one the answer declares. */
export interface VerdictTargetMismatchError {
  readonly code: "VERDICT_TARGET_MISMATCH";
  readonly message: string;
  readonly ts: string;
  /** The timestamp the reviewer actually judged. */
  readonly reviewedTs: string;
}

/** The reviewer looked at this exact target and said the delete is not warranted. */
export interface NotWarrantedError {
  readonly code: "NOT_WARRANTED";
  readonly message: string;
  readonly ts: string;
  /** The reviewer's own words, carried so the journal records why rather than only that. */
  readonly reason: string;
}

/** The verdict warranting this delete was written by the session that composed the answer. */
export interface SelfReviewedError {
  readonly code: "SELF_REVIEWED";
  readonly message: string;
  readonly ts: string;
  /** The session that is both author and reviewer on the verdict. */
  readonly session: string;
}

/** The warrant is bound to a DIFFERENT answer than the one this turn posted. */
export interface StaleWarrantError {
  readonly code: "STALE_WARRANT";
  readonly message: string;
  readonly ts: string;
  /** The digest the reviewer bound the verdict to. */
  readonly reviewedDigest: string;
  /** The digest of the answer that actually went out. */
  readonly postedDigest: string;
}

/** No completion this installation recorded says slopweaver ever posted an answer at that timestamp. */
export interface NoSuchAnswerError {
  readonly code: "NO_SUCH_ANSWER";
  readonly message: string;
  readonly ts: string;
}

/** A completion names that answer, and it belongs to a different channel or thread than this correction. */
export interface ForeignThreadError {
  readonly code: "FOREIGN_THREAD";
  readonly message: string;
  readonly ts: string;
  /** Where the recorded answer actually lives, as `<channel>/<threadTs>`. */
  readonly recordedIn: string;
  /** Where this correction is being posted, same spelling. */
  readonly correctingIn: string;
}

/** Slack's own read-back does not put the live message in this correction's thread. */
export interface LiveThreadMismatchError {
  readonly code: "LIVE_THREAD_MISMATCH";
  readonly message: string;
  readonly ts: string;
  /** The `thread_ts` Slack reports, or `undefined` when the message hangs at a channel root. */
  readonly liveThreadTs: string | undefined;
  readonly correctingThreadTs: string;
}

/** The message was edited after the completion that recorded it, so it is no longer the answer that was judged. */
export interface EditedSinceError {
  readonly code: "EDITED_SINCE";
  readonly message: string;
  readonly ts: string;
  /** `edited.ts`, as Slack reports it. */
  readonly editedTs: string;
}

/**
 * This journal already holds an INTENT for the same turn and the same target, so a delete was attempted.
 *
 * The at-most-once arm, and it is judged on the intent row rather than on the result row on purpose: an
 * intent with no result is a session that died mid-delete, which is precisely the case where a re-run must
 * NOT try again. What happened to that first attempt is unknown from here, and an unknown outcome on an
 * irreversible act refuses, like every other arm in this union.
 */
export interface AlreadyAttemptedError {
  readonly code: "ALREADY_ATTEMPTED";
  readonly message: string;
  readonly ts: string;
  /** The instant the earlier intent row carries. */
  readonly intendedIso: string;
}

/**
 * The journal that answers "was this pair already attempted" could not be read, so the answer is unknown.
 *
 * Separate from {@link AlreadyAttemptedError} because it is a different finding for an auditor — one says a
 * delete was attempted, this one says we cannot tell — and both refuse for the same reason the rest of this
 * union does: an unknown outcome on an irreversible act leaves the message standing.
 */
export interface JournalUnreadableError {
  readonly code: "JOURNAL_UNREADABLE";
  readonly message: string;
  readonly ts: string;
  /** What the open failed with, so a reader knows whether to chase permissions or a disk. */
  readonly cause: string;
}

/** Every reason a correction turn's declared supersession does not become a delete. */
export type SupersessionError =
  | AlreadyAttemptedError
  | JournalUnreadableError
  | NothingDeclaredError
  | SelfTargetError
  | UnreviewedError
  | VerdictTargetMismatchError
  | NotWarrantedError
  | SelfReviewedError
  | StaleWarrantError
  | NoSuchAnswerError
  | ForeignThreadError
  | LiveThreadMismatchError
  | EditedSinceError;

/** Build one {@link SupersessionError}. The factory the real code calls, so a test built the same way stays honest. */
export const SupersessionErrors = {
  alreadyAttempted: ({ ts, intendedIso }: { ts: string; intendedIso: string }): AlreadyAttemptedError => ({
    code: "ALREADY_ATTEMPTED",
    intendedIso,
    message:
      `this turn already journalled an intent to delete ${ts} at ${intendedIso} — a delete is attempted ` +
      "at most once per turn and target, whatever that first attempt went on to report",
    ts,
  }),
  editedSince: ({ ts, editedTs }: { ts: string; editedTs: string }): EditedSinceError => ({
    code: "EDITED_SINCE",
    editedTs,
    message:
      `${ts} was edited at ${editedTs}, after the completion that recorded it — the words standing there ` +
      "now are not the ones this correction supersedes, so it stays up",
    ts,
  }),
  foreignThread: ({
    ts,
    recordedIn,
    correctingIn,
  }: {
    ts: string;
    recordedIn: string;
    correctingIn: string;
  }): ForeignThreadError => ({
    code: "FOREIGN_THREAD",
    correctingIn,
    message:
      `${ts} was answered in ${recordedIn} and this correction is posting in ${correctingIn} — a correction ` +
      "only ever deletes an answer standing in its own thread",
    recordedIn,
    ts,
  }),
  journalUnreadable: ({ ts, cause }: { ts: string; cause: string }): JournalUnreadableError => ({
    cause,
    code: "JOURNAL_UNREADABLE",
    message:
      `the supersession journal could not be read, so whether this turn already tried to delete ${ts} is ` +
      `unknown — ${cause}`,
    ts,
  }),
  liveThreadMismatch: ({
    ts,
    liveThreadTs,
    correctingThreadTs,
  }: {
    ts: string;
    liveThreadTs: string | undefined;
    correctingThreadTs: string;
  }): LiveThreadMismatchError => {
    // An `if` rather than `liveThreadTs ?? "…"` or a ternary, and both bans point the same way here: the
    // `no-silent-fallback` rule refuses the operator, and oxlint's `prefer-nullish-coalescing` refuses the
    // ternary back into it. What survives both also reads best, because the two cases are genuinely
    // different findings — an ABSENT thread_ts is a channel-root message, not a message in somebody
    // else's thread.
    let where = "no thread at all — it is a channel-root message";
    if (liveThreadTs !== undefined) {
      where = liveThreadTs;
    }
    return {
      code: "LIVE_THREAD_MISMATCH",
      correctingThreadTs,
      liveThreadTs,
      message:
        `Slack puts ${ts} in ${where} while this correction is in ${correctingThreadTs} — the local record ` +
        "and the live message disagree, so nothing is deleted",
      ts,
    };
  },
  noSuchAnswer: ({ ts }: { ts: string }): NoSuchAnswerError => ({
    code: "NO_SUCH_ANSWER",
    message:
      `no completion this install recorded says slopweaver posted an answer at ${ts} — a supersession only ` +
      "ever removes an answer THIS program can prove it wrote",
    ts,
  }),
  nothingDeclared: (): NothingDeclaredError => ({
    code: "NOTHING_DECLARED",
    message: "the answer declared no `supersedes`, so this turn is additive and deletes nothing",
  }),
  notWarranted: ({ ts, reason }: { ts: string; reason: string }): NotWarrantedError => ({
    code: "NOT_WARRANTED",
    message: `the review judged the supersession of ${ts} unwarranted — ${reason}`,
    reason,
    ts,
  }),
  selfReviewed: ({ ts, session }: { ts: string; session: string }): SelfReviewedError => ({
    code: "SELF_REVIEWED",
    message:
      `the verdict warranting the delete of ${ts} names ${session} as both author and reviewer — the ` +
      "session that composed the correction cannot also be the one that authorised removing what it replaces",
    session,
    ts,
  }),
  selfTarget: ({ ts }: { ts: string }): SelfTargetError => ({
    code: "SELF_TARGET",
    message: `${ts} is the answer this turn just posted — an answer never supersedes itself`,
    ts,
  }),
  staleWarrant: ({
    ts,
    reviewedDigest,
    postedDigest,
  }: {
    ts: string;
    reviewedDigest: string;
    postedDigest: string;
  }): StaleWarrantError => ({
    code: "STALE_WARRANT",
    message:
      `the verdict warranting the delete of ${ts} is bound to ${reviewedDigest} and this turn posted ` +
      `${postedDigest} — the answer the reviewer read is not the answer standing in the thread`,
    postedDigest,
    reviewedDigest,
    ts,
  }),
  unreviewed: ({ ts }: { ts: string }): UnreviewedError => ({
    code: "UNREVIEWED",
    message:
      `no review verdict judges the supersession of ${ts} — an answer may DECLARE what it replaces, but a ` +
      "delete needs a reviewer who looked at both messages and said so",
    ts,
  }),
  verdictTargetMismatch: ({ ts, reviewedTs }: { ts: string; reviewedTs: string }): VerdictTargetMismatchError => ({
    code: "VERDICT_TARGET_MISMATCH",
    message: `the review judged the supersession of ${reviewedTs}, and this answer declares ${ts}`,
    reviewedTs,
    ts,
  }),
} as const;
