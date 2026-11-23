/**
 * Everything reading and recording one Claude plan's monthly spend can fail on — `slopweaver claude spend` and the
 * recorded readings it leaves. It stands alone, per `.claude/rules/error-handling.md`: binding the login is
 * `claude reset`'s union (`./resetErrors.ts`), because both verbs bind the same profile-scoped sign-in; this one
 * answers "what did this plan spend this month".
 *
 * Distinct variants because each asks for a different next move: a throttled read is re-run after its retry-after,
 * an answer with no spend block is a plan the provider sends no spend for, an unreadable answer names a drifted field
 * to declare, and an unreadable recorded reading is a ledger to repair. **No variant carries a token or an
 * organisation id.**
 */

/** The usage answer failed, or carried a field this code cannot read — the drifted field named. */
export interface SpendStatusUnreadableError {
  readonly code: "SPEND_STATUS_UNREADABLE";
  readonly message: string;
}

/** The answer carried no `extra_usage` block at all — distinct from a block saying spend is disabled or zero. */
export interface SpendBlockAbsentError {
  readonly code: "SPEND_BLOCK_ABSENT";
  readonly message: string;
}

/**
 * The block says spend can cover sends, yet leaves out a figure a verdict needs — the limit, the spend or the
 * currency. Nothing is recorded: a reading with a hole in it is the shape a later reader could fill with zero.
 */
export interface SpendAmountAbsentError {
  readonly code: "SPEND_AMOUNT_ABSENT";
  readonly message: string;
  /** The wire fields the provider sent as `null`. */
  readonly fields: readonly string[];
}

/** The read was throttled — its budget is shared with every `/usage` on the machine. */
export interface SpendRateLimitedError {
  readonly code: "SPEND_RATE_LIMITED";
  readonly message: string;
  /** The provider's own retry-after, in seconds, when it sent one. */
  readonly retryAfterSeconds?: number;
}

/** A recorded spend reading could not be read back, or does not hold the shape this build writes. */
export interface SpendReadingUnreadableError {
  readonly code: "SPEND_READING_UNREADABLE";
  readonly message: string;
}

/** Every way reading or recording a plan's monthly spend fails. */
export type ClaudeSpendError =
  | SpendStatusUnreadableError
  | SpendBlockAbsentError
  | SpendAmountAbsentError
  | SpendRateLimitedError
  | SpendReadingUnreadableError;

/** The factory every failure above is built through, so a message is worded once. */
export const ClaudeSpendErrors = {
  amountAbsent: ({ fields }: { fields: readonly string[] }): SpendAmountAbsentError => ({
    code: "SPEND_AMOUNT_ABSENT",
    fields,
    message:
      `extra usage is enabled but ${fields.join(", ")} came back null, so this plan's monthly spend is unknown — ` +
      "never zero, and nothing is recorded",
  }),
  blockAbsent: (): SpendBlockAbsentError => ({
    code: "SPEND_BLOCK_ABSENT",
    message: "the usage answer carried no `extra_usage` block, so this plan's monthly spend is unknown — never zero",
  }),
  rateLimited: ({ retryAfterSeconds }: { retryAfterSeconds?: number }): SpendRateLimitedError => ({
    code: "SPEND_RATE_LIMITED",
    message:
      retryAfterSeconds === undefined
        ? "the usage read was throttled (HTTP 429); its budget is shared with every /usage on this machine — re-run later"
        : `the usage read was throttled (HTTP 429); re-run after ${String(retryAfterSeconds)}s`,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  }),
  readingUnreadable: ({ detail }: { detail: string }): SpendReadingUnreadableError => ({
    code: "SPEND_READING_UNREADABLE",
    message: `a recorded spend reading could not be read: ${detail}`,
  }),
  statusUnreadable: ({ detail }: { detail: string }): SpendStatusUnreadableError => ({
    code: "SPEND_STATUS_UNREADABLE",
    message: `the usage answer could not be read: ${detail}`,
  }),
} as const;
