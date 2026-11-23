/**
 * Everything `slopweaver claude reset` can fail on, as one union scoped to reading and claiming a Claude plan's free
 * usage-limit reset. It stands alone, per `.claude/rules/error-handling.md`: the routing union in `./errors.ts`
 * answers "may this session boot", this one answers "may this reset be spent", and the next moves differ.
 *
 * Distinct variants because each asks for a different next move: no qualifying sign-in is a sign-in only the owner can
 * do, an unestablished binding and a throttled status read are re-run later, a grant that cannot be used now is
 * simply finished, a cooldown is waited on, and an ANSWER that never came back is retried under the SAME request
 * id — which is why that variant carries it. **No variant carries a token or an organisation id.**
 */

/** No enrolled account stands for the plan, so no credential can be proven to be its own. */
export interface PlanUnboundError {
  readonly code: "PLAN_UNBOUND";
  readonly message: string;
  readonly alias: string;
}

/** Neither the plan's own store nor the default slot holds a profile-scoped login proven to be this plan's. */
export interface NoQualifyingLoginError {
  readonly code: "NO_QUALIFYING_LOGIN";
  readonly message: string;
  readonly alias: string;
  /** One line per candidate, naming why it did not qualify. */
  readonly reasons: readonly string[];
}

/** A candidate passed every static check, but the probe named no organisation, so which plan it is stays open. */
export interface BindingUnestablishedError {
  readonly code: "BINDING_UNESTABLISHED";
  readonly message: string;
  readonly alias: string;
}

/** The status answer carried no `cedar_ember` block at all — distinct from a block saying "not eligible". */
export interface ResetBlockAbsentError {
  readonly code: "RESET_BLOCK_ABSENT";
  readonly message: string;
}

/** The status read failed or answered something this code cannot read. */
export interface StatusUnreadableError {
  readonly code: "STATUS_UNREADABLE";
  readonly message: string;
}

/** The status read was throttled — its budget is shared with every `/usage` on the machine. */
export interface StatusRateLimitedError {
  readonly code: "STATUS_RATE_LIMITED";
  readonly message: string;
  /** The provider's own retry-after, in seconds, when it sent one. */
  readonly retryAfterSeconds?: number;
}

/** The provider says the account is not eligible for a free reset. */
export interface NotEligibleError {
  readonly code: "NOT_ELIGIBLE";
  readonly message: string;
}

/** No grant the plan holds can be used right now. */
export interface NoUsableGrantError {
  readonly code: "NO_USABLE_GRANT";
  readonly message: string;
}

/** `--grant` named a grant the status read does not list. */
export interface GrantNotHeldError {
  readonly code: "GRANT_NOT_HELD";
  readonly message: string;
  readonly grantId: string;
}

/** A reset cooldown is running, so a claim now would be refused. */
export interface CooldownError {
  readonly code: "COOLDOWN";
  readonly message: string;
  readonly untilIso: string;
}

/** The claim was sent and no answer the provider stands behind came back — it may or may not have spent. */
export interface ClaimOutcomeUnknownError {
  readonly code: "OUTCOME_UNKNOWN";
  readonly message: string;
  /** The id a retry must reuse, so the provider settles one attempt rather than spending a second reset. */
  readonly requestId: string;
}

/** The provider refused the CALL itself (401/403) before acting on it. */
export interface ClaimRefusedError {
  readonly code: "CLAIM_REFUSED";
  readonly message: string;
  readonly status: number;
}

/** The claims journal would not read or append, so an attempt could not be made safely retryable. */
export interface ClaudeResetJournalFailedError {
  readonly code: "RESET_JOURNAL_FAILED";
  readonly message: string;
}

/** One claims journal line is not a row this version writes. */
export interface ClaudeResetJournalLineInvalidError {
  readonly code: "JOURNAL_LINE_INVALID";
  readonly message: string;
}

/** Everything `slopweaver claude reset` can fail on. */
export type ClaudeResetError =
  | PlanUnboundError
  | NoQualifyingLoginError
  | BindingUnestablishedError
  | ResetBlockAbsentError
  | StatusUnreadableError
  | StatusRateLimitedError
  | NotEligibleError
  | NoUsableGrantError
  | GrantNotHeldError
  | CooldownError
  | ClaimOutcomeUnknownError
  | ClaimRefusedError
  | ClaudeResetJournalFailedError
  | ClaudeResetJournalLineInvalidError;

/** Builds each variant, so a test constructs a failure exactly as the real code does. */
export const ClaudeResetErrors = {
  bindingUnestablished: ({ alias }: { alias: string }): BindingUnestablishedError => ({
    alias,
    code: "BINDING_UNESTABLISHED",
    message:
      `${alias}: the probe answered without naming an organisation, so this login could not be proven to be ` +
      `${alias}'s — nothing was read or claimed; re-run later`,
  }),
  claimRefused: ({ status }: { status: number }): ClaimRefusedError => ({
    code: "CLAIM_REFUSED",
    message: `the provider refused the claim call with HTTP ${String(status)} before acting on it`,
    status,
  }),
  cooldown: ({ untilIso }: { untilIso: string }): CooldownError => ({
    code: "COOLDOWN",
    message: `a reset cooldown runs until ${untilIso}; re-run after it`,
    untilIso,
  }),
  grantNotHeld: ({ grantId }: { grantId: string }): GrantNotHeldError => ({
    code: "GRANT_NOT_HELD",
    grantId,
    message: `the status read lists no grant with id ${grantId}`,
  }),
  journalFailed: ({ cause, operation }: { cause: string; operation: string }): ClaudeResetJournalFailedError => ({
    code: "RESET_JOURNAL_FAILED",
    message: `${operation}: ${cause}`,
  }),
  journalLineInvalid: ({ detail }: { detail: string }): ClaudeResetJournalLineInvalidError => ({
    code: "JOURNAL_LINE_INVALID",
    message: `a claims journal line ${detail}`,
  }),
  noQualifyingLogin: ({ alias, reasons }: { alias: string; reasons: readonly string[] }): NoQualifyingLoginError => ({
    alias,
    code: "NO_QUALIFYING_LOGIN",
    message: `${alias}: no profile-scoped sign-in proven to be this plan's (${reasons.join("; ")})`,
    reasons,
  }),
  noUsableGrant: ({ why }: { why: string }): NoUsableGrantError => ({
    code: "NO_USABLE_GRANT",
    message: `no reset can be claimed now — ${why}`,
  }),
  notEligible: ({ reason }: { reason: string }): NotEligibleError => ({
    code: "NOT_ELIGIBLE",
    message: `the account is not eligible for a free reset (${reason})`,
  }),
  outcomeUnknown: ({ reason, requestId }: { reason: string; requestId: string }): ClaimOutcomeUnknownError => ({
    code: "OUTCOME_UNKNOWN",
    message: `the claim ${requestId} has no answer (${reason}) — re-run to settle it under the same request id`,
    requestId,
  }),
  planUnbound: ({ alias }: { alias: string }): PlanUnboundError => ({
    alias,
    code: "PLAN_UNBOUND",
    message: `${alias}: no account is enrolled for this plan; enrol one with \`slopweaver claude signin --enroll ${alias}\``,
  }),
  resetBlockAbsent: (): ResetBlockAbsentError => ({
    code: "RESET_BLOCK_ABSENT",
    message: "the usage answer carried no cedar_ember block, so the reset state is unknown",
  }),
  statusRateLimited: ({ retryAfterSeconds }: { retryAfterSeconds?: number }): StatusRateLimitedError => ({
    code: "STATUS_RATE_LIMITED",
    message:
      retryAfterSeconds === undefined
        ? "the status read was throttled (429); re-run later"
        : `the status read was throttled (429); re-run after ${String(retryAfterSeconds)}s`,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  }),
  statusUnreadable: ({ detail }: { detail: string }): StatusUnreadableError => ({
    code: "STATUS_UNREADABLE",
    message: `the reset status could not be read: ${detail}`,
  }),
} as const;
