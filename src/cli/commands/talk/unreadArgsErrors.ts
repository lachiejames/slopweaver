/**
 * Every way a `talk unread` invocation is refused before anything is read — its own union, because the verb's
 * whole point is that nothing is skipped, and a caller printing these should never have to guess what failed.
 */

/** A flag the tokenizer refused — unknown, or missing its value; the messages are the tokenizer's own. */
export interface UnreadFlagsInvalidError {
  readonly code: "UNREAD_FLAGS_INVALID";
  readonly message: string;
}

/** `--now` that is not an instant. */
export interface UnreadNowInvalidError {
  readonly code: "UNREAD_NOW_INVALID";
  readonly message: string;
  readonly now: string;
}

/** `--adopt` with no `--mark` to qualify — adopting is only ever part of a mark. */
export interface UnreadAdoptWithoutMarkError {
  readonly code: "UNREAD_ADOPT_WITHOUT_MARK";
  readonly message: string;
}

/** `talk unread-adopt` with no `--before`, or one that is not a canonical ISO instant. */
export interface UnreadAdoptBeforeInvalidError {
  readonly code: "UNREAD_ADOPT_BEFORE_INVALID";
  readonly message: string;
}

/** `talk unread-adopt --before` later than now — adopting words not yet spoken is never asked for. */
export interface UnreadAdoptBeforeFutureError {
  readonly code: "UNREAD_ADOPT_BEFORE_FUTURE";
  readonly message: string;
}

/** `talk unread-adopt --approve` that is not a digest a preview prints. */
export interface UnreadAdoptApproveInvalidError {
  readonly code: "UNREAD_ADOPT_APPROVE_INVALID";
  readonly message: string;
}

/** `talk unread-adopt` with no `--why` — a receipt with no reason says nothing a later reader can check. */
export interface UnreadAdoptWhyMissingError {
  readonly code: "UNREAD_ADOPT_WHY_MISSING";
  readonly message: string;
}

/** Every way a `talk unread` or `talk unread-adopt` invocation is refused. */
export type UnreadArgsError =
  | UnreadFlagsInvalidError
  | UnreadNowInvalidError
  | UnreadAdoptWithoutMarkError
  | UnreadAdoptBeforeInvalidError
  | UnreadAdoptBeforeFutureError
  | UnreadAdoptApproveInvalidError
  | UnreadAdoptWhyMissingError;

/** The factories every `talk unread` usage refusal is constructed through. */
export const UnreadArgsErrors = {
  adoptApproveInvalid: (): UnreadAdoptApproveInvalidError => ({
    code: "UNREAD_ADOPT_APPROVE_INVALID",
    message: "talk unread-adopt --approve takes the digest a preview printed: adopt- and 16 hex characters",
  }),
  adoptBeforeFuture: ({ before, now }: { before: string; now: string }): UnreadAdoptBeforeFutureError => ({
    code: "UNREAD_ADOPT_BEFORE_FUTURE",
    message: `talk unread-adopt --before ${before} is later than now (${now}); only words already spoken can be adopted`,
  }),
  adoptBeforeInvalid: (): UnreadAdoptBeforeInvalidError => ({
    code: "UNREAD_ADOPT_BEFORE_INVALID",
    message:
      "talk unread-adopt needs --before <iso>, a canonical ISO instant such as 2026-11-17T06:00:00.000Z — " +
      "every line stamped strictly before it is adopted",
  }),
  adoptWhyMissing: (): UnreadAdoptWhyMissingError => ({
    code: "UNREAD_ADOPT_WHY_MISSING",
    message:
      'talk unread-adopt needs --why "<who already read these words, and where that is recorded>" — ' +
      "the digest binds it and the receipt carries it",
  }),
  adoptWithoutMark: (): UnreadAdoptWithoutMarkError => ({
    code: "UNREAD_ADOPT_WITHOUT_MARK",
    message: "talk unread --adopt only qualifies a --mark",
  }),
  flagsInvalid: ({ messages }: { messages: readonly string[] }): UnreadFlagsInvalidError => ({
    code: "UNREAD_FLAGS_INVALID",
    message: messages.join("; "),
  }),
  nowInvalid: ({ now }: { now: string }): UnreadNowInvalidError => ({
    code: "UNREAD_NOW_INVALID",
    message: `talk unread --now ${now} is not an ISO instant`,
    now,
  }),
} as const;
