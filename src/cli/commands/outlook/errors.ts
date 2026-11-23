/**
 * The typed failures of parsing one `outlook` verb's argv tail, before a credential is read or a socket opened.
 *
 * Separate from the provider's own `OutlookError` (`live/outlook/errors.ts`): that one names what MICROSOFT
 * said, these name what the COMMAND LINE got wrong. Every variant carries the verb's `usage`, because each
 * refusal is printed beside it. A list the flag tokeniser already produced rides as `reasons`, one per line.
 */

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface OutlookFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
  readonly usage: string;
}

/** A positional the verb needs was not given, or a flag stood where it should be. */
export interface OutlookArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  /** The positional as the usage line names it, e.g. `<message-id>`. */
  readonly name: string;
  readonly usage: string;
}

/** A required flag was not given. */
export interface OutlookFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
  readonly usage: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface OutlookInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
  readonly usage: string;
}

/** Two flags that select different modes of one verb were both given; `flags` names them. */
export interface OutlookModesConflictError {
  readonly code: "MODES_CONFLICT";
  readonly message: string;
  readonly flags: readonly string[];
  readonly usage: string;
}

/** A change verb was given nothing to change, or the same thing in both directions. */
export interface OutlookNothingToChangeError {
  readonly code: "NOTHING_TO_CHANGE";
  readonly message: string;
  readonly usage: string;
}

/** Every way parsing one `outlook` verb's argv tail can fail. */
export type OutlookArgsError =
  | OutlookFlagsInvalidError
  | OutlookArgumentMissingError
  | OutlookFlagMissingError
  | OutlookInvalidFlagValueError
  | OutlookModesConflictError
  | OutlookNothingToChangeError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const OutlookArgsErrors = {
  argumentMissing: ({ name, usage }: { name: string; usage: string }): OutlookArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: `missing ${name}`,
    name,
    usage,
  }),
  flagMissing: ({
    flag,
    message,
    usage,
  }: {
    flag: string;
    message: string;
    usage: string;
  }): OutlookFlagMissingError => ({
    code: "FLAG_MISSING",
    flag,
    message,
    usage,
  }),
  flagsInvalid: ({ reasons, usage }: { reasons: readonly string[]; usage: string }): OutlookFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("\n"),
    reasons,
    usage,
  }),
  invalidValue: ({
    flag,
    got,
    message,
    usage,
  }: {
    flag: string;
    got: string;
    message: string;
    usage: string;
  }): OutlookInvalidFlagValueError => ({ code: "INVALID_FLAG_VALUE", flag, got, message, usage }),
  modesConflict: ({ flags, usage }: { flags: readonly string[]; usage: string }): OutlookModesConflictError => ({
    code: "MODES_CONFLICT",
    flags,
    message: `${flags.join(" and ")} select different modes — give at most one`,
    usage,
  }),
  nothingToChange: ({ message, usage }: { message: string; usage: string }): OutlookNothingToChangeError => ({
    code: "NOTHING_TO_CHANGE",
    message,
    usage,
  }),
} as const;

/**
 * The lines one refusal prints ahead of its usage: the tokeniser's list as that list, every other refusal as
 * its one message.
 *
 * @returns the lines, in order, without the usage
 */
export function outlookArgsErrorLines({ error }: { error: OutlookArgsError }): readonly string[] {
  if (error.code === "FLAGS_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
