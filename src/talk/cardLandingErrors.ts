/**
 * The card-landing module's typed errors — its own union, never shared (`.claude/rules/error-handling.md`).
 *
 * A caller branches on three of these: `CARD_NOT_LANDED` is what `talk restore` answers for a card nothing
 * pulled, `RESTORE_UNSHAPED` is the one refusal of POLICY-shaped fact here — an ask whose open question
 * cannot be restated whole is not re-asked with a guess — and `CARD_NOT_HIS` is a `pr:` card whose pull
 * request is somebody else's, which `talk transcript` passes over rather than counting as a failure.
 * `NOT_AN_ANSWER` is passed over the same way: a hand step, or words that are only greeting or filler.
 */

/** The key does not name a console card. */
export interface CardKeyInvalidError {
  readonly code: "CARD_KEY_INVALID";
  readonly message: string;
  readonly cardKey: string;
}

/** The landing ledger could not be read or written. */
export interface LedgerIoError {
  readonly code: "LEDGER_IO";
  readonly message: string;
  readonly path: string;
}

/** The ask a word was said over is on no board, active or archived. */
export interface AskMissingError {
  readonly code: "ASK_MISSING";
  readonly message: string;
  readonly slug: string;
}

/** The board write a landing needs — the ruling, or the dispatch row — did not land. */
export interface BoardWriteFailedError {
  readonly code: "BOARD_WRITE_FAILED";
  readonly message: string;
  readonly slug: string;
}

/** A restore named a card no active landing holds. */
export interface CardNotLandedError {
  readonly code: "CARD_NOT_LANDED";
  readonly message: string;
  readonly cardKey: string;
}

/** A restore of an ask whose open question cannot be restated whole. */
export interface RestoreUnshapedError {
  readonly code: "RESTORE_UNSHAPED";
  readonly message: string;
  readonly slug: string;
}

/** The landing reading a `pr:` card's subject is decided from could not be read — a ledger fault, never an absence. */
export interface SubjectUnreadableError {
  readonly code: "SUBJECT_UNREADABLE";
  readonly message: string;
  readonly cardKey: string;
}

/** A `pr:` card whose pull request the newest landing reading says is not the owner's: the owner's words are not its to hold. */
export interface CardNotOwnerError {
  readonly code: "CARD_NOT_HIS";
  readonly message: string;
  readonly cardKey: string;
}

/** Words that are never an answer to the card they were said over: a hand step, or greeting and filler (`./cardAnswer.ts`). */
export interface NotAnAnswerError {
  readonly code: "NOT_AN_ANSWER";
  readonly message: string;
  readonly cardKey: string;
  readonly reason: "hand-step" | "not-an-answer";
}

/** Every way landing or restoring a card fails. */
export type CardLandingError =
  | CardNotOwnerError
  | NotAnAnswerError
  | SubjectUnreadableError
  | CardKeyInvalidError
  | LedgerIoError
  | AskMissingError
  | BoardWriteFailedError
  | CardNotLandedError
  | RestoreUnshapedError;

/** The one place each variant's message is worded. */
export const CardLandingErrors = {
  cardNotOwner: ({ cardKey, why }: { cardKey: string; why: string }): CardNotOwnerError => ({
    cardKey,
    code: "CARD_NOT_HIS",
    message: `the owner's words do not land on ${cardKey}: ${why}`,
  }),
  notAnAnswer: ({
    cardKey,
    reason,
    why,
  }: {
    cardKey: string;
    reason: NotAnAnswerError["reason"];
    why: string;
  }): NotAnAnswerError => ({
    cardKey,
    code: "NOT_AN_ANSWER",
    message: `the owner's words do not land on ${cardKey}: ${why}`,
    reason,
  }),
  subjectUnreadable: ({ cardKey, why }: { cardKey: string; why: string }): SubjectUnreadableError => ({
    cardKey,
    code: "SUBJECT_UNREADABLE",
    message: `whose pull request ${cardKey} is could not be read off the landing reading — ${why}`,
  }),
  askMissing: ({ slug }: { slug: string }): AskMissingError => ({
    code: "ASK_MISSING",
    message: `no row on the board, active or archived, claims the slug "${slug}"`,
    slug,
  }),
  boardWriteFailed: ({ slug, why }: { slug: string; why: string }): BoardWriteFailedError => ({
    code: "BOARD_WRITE_FAILED",
    message: `the board write for ${slug} did not land — ${why}`,
    slug,
  }),
  cardKeyInvalid: ({ cardKey }: { cardKey: string }): CardKeyInvalidError => ({
    cardKey,
    code: "CARD_KEY_INVALID",
    message: `"${cardKey}" is not a Queue card key — expected <ask|hand|draft|post|review|import|pr|act>:<id>, a pull request's being pr:<owner>.<repo>.<n>`,
  }),
  cardNotLanded: ({ cardKey }: { cardKey: string }): CardNotLandedError => ({
    cardKey,
    code: "CARD_NOT_LANDED",
    message: `no word of the owner's is holding ${cardKey} off the queue, so there is nothing to restore`,
  }),
  ledgerIo: ({ path, cause }: { path: string; cause: unknown }): LedgerIoError => ({
    code: "LEDGER_IO",
    message: `the card-landing ledger at ${path} could not be used — ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  restoreUnshaped: ({ slug, why }: { slug: string; why: string }): RestoreUnshapedError => ({
    code: "RESTORE_UNSHAPED",
    message: `${slug} cannot be put back on the owner's queue: ${why}`,
    slug,
  }),
} as const;
