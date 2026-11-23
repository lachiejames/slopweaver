/**
 * The typed failures of parsing one `gmail` verb's argv tail, before a credential is read or a socket opened.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory and separate from
 * the provider's own `GmailError` (`live/gmail/errors.ts`): that one names what GOOGLE said, these name what
 * the COMMAND LINE got wrong. Every variant carries the verb's `usage`, because each refusal is printed
 * beside it. A list another module already produced — the flag tokeniser's refusals, the `--board` checks
 * — rides as `reasons`, and its `message` puts one reason per line, so a caller printing `message` then
 * `usage` writes exactly the lines the list used to print.
 */
import type { GmailError } from "../../../live/gmail/errors.js";

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface GmailFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
  readonly usage: string;
}

/** The leading positional a verb needs was not given, or a flag stood where it should be. */
export interface GmailArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  /** The positional as the usage line names it, e.g. `<message-id>`. */
  readonly name: string;
  readonly usage: string;
}

/** A required flag was not given. */
export interface GmailFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
  readonly usage: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface GmailInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
  readonly usage: string;
}

/** `gmail label` was given neither an `--add` nor a `--remove`, so there is nothing to change. */
export interface GmailNothingToChangeError {
  readonly code: "NOTHING_TO_CHANGE";
  readonly message: string;
  readonly usage: string;
}

/** `gmail mark` was given both directions, or neither — the two outcomes are opposites, so none is a default. */
export interface GmailDirectionUnclearError {
  readonly code: "DIRECTION_UNCLEAR";
  readonly message: string;
  readonly given: "both" | "neither";
  readonly usage: string;
}

/** The attachment selector was refused; `cause` is the provider module's own error, forwarded unchanged. */
export interface GmailSelectorInvalidError {
  readonly code: "SELECTOR_INVALID";
  readonly message: string;
  readonly cause: GmailError;
  readonly usage: string;
}

/** The `--board` spelling of `gmail draft` met one or more conflicting flags; `reasons` names each. */
export interface GmailBoardArgsInvalidError {
  readonly code: "BOARD_ARGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
  readonly usage: string;
}

/** Every way parsing one `gmail` verb's argv tail can fail. */
export type GmailArgsError =
  | GmailFlagsInvalidError
  | GmailArgumentMissingError
  | GmailFlagMissingError
  | GmailInvalidFlagValueError
  | GmailNothingToChangeError
  | GmailDirectionUnclearError
  | GmailSelectorInvalidError
  | GmailBoardArgsInvalidError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const GmailArgsErrors = {
  argumentMissing: ({ name, usage }: { name: string; usage: string }): GmailArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: `missing ${name}`,
    name,
    usage,
  }),
  boardArgsInvalid: ({
    reasons,
    usage,
  }: {
    reasons: readonly string[];
    usage: string;
  }): GmailBoardArgsInvalidError => ({
    code: "BOARD_ARGS_INVALID",
    message: reasons.join("\n"),
    reasons,
    usage,
  }),
  directionUnclear: ({ given, usage }: { given: "both" | "neither"; usage: string }): GmailDirectionUnclearError => ({
    code: "DIRECTION_UNCLEAR",
    given,
    message:
      given === "both"
        ? "--read and --unread are opposites; give exactly one"
        : "give exactly one of --read or --unread",
    usage,
  }),
  flagsInvalid: ({ reasons, usage }: { reasons: readonly string[]; usage: string }): GmailFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("\n"),
    reasons,
    usage,
  }),
  formMissing: ({ usage }: { usage: string }): GmailFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message: "--form is required: pass JSON, or `-` to read it from stdin (recommended for prose)",
    usage,
  }),
  grantUnknown: ({
    grant,
    known,
    usage,
  }: {
    grant: string;
    known: readonly string[];
    usage: string;
  }): GmailInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--grant",
    got: grant,
    message: `unknown --grant: ${grant} (expected ${known.join(" | ")})`,
    usage,
  }),
  limitOutOfRange: ({ got, max, usage }: { got: string; max: number; usage: string }): GmailInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit must be an integer between 1 and ${String(max)}`,
    usage,
  }),
  keyRequired: ({ usage }: { usage: string }): GmailFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--key",
    message: "--pin records ONE group's ids, so it needs --key naming that group",
    usage,
  }),
  cardSlugInvalid: ({
    flag,
    got,
    usage,
  }: {
    flag: string;
    got: string;
    usage: string;
  }): GmailInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag,
    got,
    message: `${flag} takes a card slug of lower-case letters, digits and hyphens, not ${got}`,
    usage,
  }),
  triageSlugInvalid: ({ got, usage }: { got: string; usage: string }): GmailInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "<card-slug>",
    got,
    message: `takes an inbox-triage card's slug — inbox-triage-… in lower-case letters, digits and hyphens — not ${got}`,
    usage,
  }),
  tooManyIds: ({ got, max, usage }: { got: number; max: number; usage: string }): GmailInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "<message-id>",
    got: String(got),
    message: `at most ${String(max)} ids in one call, not ${String(got)} — split the set`,
    usage,
  }),
  maxFileSizeInvalid: ({
    got,
    reasons,
    usage,
  }: {
    got: string;
    reasons: readonly string[];
    usage: string;
  }): GmailInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--max-file-mb",
    got,
    message: reasons.join("\n"),
    usage,
  }),
  nothingToChange: ({ usage }: { usage: string }): GmailNothingToChangeError => ({
    code: "NOTHING_TO_CHANGE",
    message: "nothing to change — give at least one --add or --remove",
    usage,
  }),
  sampleBytesNotANumber: ({ got, usage }: { got: string; usage: string }): GmailInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--sample-bytes",
    got,
    message: `--sample-bytes must be a number, not ${got}`,
    usage,
  }),
  selectorInvalid: ({ cause, usage }: { cause: GmailError; usage: string }): GmailSelectorInvalidError => ({
    cause,
    code: "SELECTOR_INVALID",
    message: cause.message,
    usage,
  }),
} as const;

/**
 * The lines one refusal prints ahead of its usage, one log record each, exactly as the verb printed them
 * before it had a type: the tokeniser's list or the `--board` checks as that list, and every other refusal
 * as its one message. `message` stays the joined form, for a caller that displays one.
 *
 * @returns the lines, in order, without the usage
 */
export function gmailArgsErrorLines({ error }: { error: GmailArgsError }): readonly string[] {
  if (error.code === "FLAGS_INVALID" || error.code === "BOARD_ARGS_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
