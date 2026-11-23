/**
 * Everything `codex reset` can fail on, as one union scoped to redeeming a Codex free usage-limit reset.
 *
 * Distinct variants because each asks for a different next move: a store with no reset to spend is simply
 * finished, a store not at a limit is waited on, an exchange that never reached the provider is retried as is,
 * and an ANSWER that never came back is retried under the SAME idempotency key — which is why that variant
 * carries it, and why it is not folded into the transport failure beside it.
 */

/** The store is signed in but holds no reset it could redeem. */
export interface NoResetHeldError {
  readonly code: "NO_RESET_HELD";
  readonly message: string;
  readonly alias: string;
}

/** `--credit` named a reset the store does not list as available. */
export interface CreditNotHeldError {
  readonly code: "CREDIT_NOT_HELD";
  readonly message: string;
  readonly alias: string;
  readonly creditId: string;
}

/** The live read found no usable sign-in, so nothing can be redeemed on the store. */
export interface StoreNotReadableError {
  readonly code: "STORE_NOT_READABLE";
  readonly message: string;
  readonly alias: string;
}

/** The consume exchange never produced an answer the provider stands behind — the reset may or may not have spent. */
export interface OutcomeUnknownError {
  readonly code: "OUTCOME_UNKNOWN";
  readonly message: string;
  readonly alias: string;
  /** The key a retry must reuse, so the provider settles one attempt rather than spending a second reset. */
  readonly idempotencyKey: string;
}

/** The claims journal would not read or append, so an attempt could not be made safely retryable. */
export interface ResetJournalFailedError {
  readonly code: "RESET_JOURNAL_FAILED";
  readonly message: string;
}

/** One claims journal line is not a row this version writes. */
export interface JournalLineInvalidError {
  readonly code: "JOURNAL_LINE_INVALID";
  readonly message: string;
}

/**
 * The exchange's lines hold no outcome the provider stands behind — refused, cut short or silent. The caller
 * that knows the attempt's key turns this into {@link OutcomeUnknownError}.
 */
export interface NoConsumeAnswerError {
  readonly code: "NO_CONSUME_ANSWER";
  readonly message: string;
}

/** Everything `codex reset` can fail on. */
export type CodexResetError =
  | NoResetHeldError
  | CreditNotHeldError
  | StoreNotReadableError
  | OutcomeUnknownError
  | ResetJournalFailedError
  | JournalLineInvalidError
  | NoConsumeAnswerError;

/** Builds each variant, so a test constructs a failure exactly as the real code does. */
export const CodexResetErrors = {
  creditNotHeld: ({ alias, creditId }: { alias: string; creditId: string }): CreditNotHeldError => ({
    alias,
    code: "CREDIT_NOT_HELD",
    creditId,
    message: `${alias} lists no available reset with id ${creditId}`,
  }),
  journalFailed: ({ cause, operation }: { cause: string; operation: string }): ResetJournalFailedError => ({
    code: "RESET_JOURNAL_FAILED",
    message: `${operation}: ${cause}`,
  }),
  journalLineInvalid: ({ detail }: { detail: string }): JournalLineInvalidError => ({
    code: "JOURNAL_LINE_INVALID",
    message: `a claims journal line ${detail}`,
  }),
  noConsumeAnswer: ({ detail }: { detail: string }): NoConsumeAnswerError => ({
    code: "NO_CONSUME_ANSWER",
    message: detail,
  }),
  noResetHeld: ({ alias }: { alias: string }): NoResetHeldError => ({
    alias,
    code: "NO_RESET_HELD",
    message: `${alias} holds no free usage-limit reset to redeem`,
  }),
  outcomeUnknown: ({
    alias,
    idempotencyKey,
    reason,
  }: {
    alias: string;
    idempotencyKey: string;
    reason: string;
  }): OutcomeUnknownError => ({
    alias,
    code: "OUTCOME_UNKNOWN",
    idempotencyKey,
    message: `${alias}: the reset attempt ${idempotencyKey} has no answer (${reason}) — re-run to settle it under the same key`,
  }),
  storeNotReadable: ({ alias, reason }: { alias: string; reason: string }): StoreNotReadableError => ({
    alias,
    code: "STORE_NOT_READABLE",
    message: `${alias}: ${reason}`,
  }),
} as const;
