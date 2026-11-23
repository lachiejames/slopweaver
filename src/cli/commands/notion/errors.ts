/**
 * The typed failures the `notion page`, `notion attach` and `notion verify` verbs author themselves: an
 * invocation that names no known sub-command, flags that are missing or carry an unusable value, and a page
 * address that cannot be resolved into an id safe to send and to name a ledger file.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory and separate from
 * `live/notion/errors.ts`'s `NotionLiveError`: that one names what READING Notion found, and is carried here
 * whole as `PAGE_ADDRESS_INVALID`'s cause rather than re-authored. The flag tokeniser's own refusals and
 * every missing-flag sentence arrive as lists and ride in `reasons`, because reporting all of them at once is
 * the behaviour.
 */
import type { NotionLiveError } from "../../../live/notion/errors.js";

/** `argv[0]` is not a sub-command the verb knows; `message` is the verb's one-line usage. */
export interface NotionUnknownSubcommandError {
  readonly code: "UNKNOWN_SUBCOMMAND";
  readonly message: string;
  readonly got: string | undefined;
}

/** `notion verify` was given no page address; `message` is the verb's one-line usage. */
export interface NotionAddressMissingError {
  readonly code: "ADDRESS_MISSING";
  readonly message: string;
}

/** `notion verify` was given more than one page address, and it checks exactly one. */
export interface NotionTooManyAddressesError {
  readonly code: "TOO_MANY_ADDRESSES";
  readonly message: string;
  readonly count: number;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface NotionInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string | undefined;
}

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface NotionFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every flag tokenised, and one or more the sub-command requires is absent or blank; `reasons` names each. */
export interface NotionArgsRefusedError {
  readonly code: "ARGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The address is not one Notion's reader can resolve to a page; `cause` says why, in its own words. */
export interface NotionPageAddressInvalidError {
  readonly code: "PAGE_ADDRESS_INVALID";
  readonly message: string;
  readonly cause: NotionLiveError;
}

/** The address resolved to an id that is not a canonical Notion UUID, so it must not reach a ledger filename. */
export interface NotionPageIdNotCanonicalError {
  readonly code: "PAGE_ID_NOT_CANONICAL";
  readonly message: string;
  readonly id: string;
}

/** Every failure this verb directory authors. */
export type NotionCommandError =
  | NotionUnknownSubcommandError
  | NotionAddressMissingError
  | NotionTooManyAddressesError
  | NotionInvalidFlagValueError
  | NotionFlagsInvalidError
  | NotionArgsRefusedError
  | NotionPageAddressInvalidError
  | NotionPageIdNotCanonicalError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const NotionCommandErrors = {
  argsRefused: ({ reasons }: { reasons: readonly string[] }): NotionArgsRefusedError => ({
    code: "ARGS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  attachUsage: ({ got }: { got: string | undefined }): NotionUnknownSubcommandError => ({
    code: "UNKNOWN_SUBCOMMAND",
    got,
    message: "usage: slopweaver notion attach --page <page> --from <md-path> [...]",
  }),
  cellLinesInvalid: ({ got }: { got: string | undefined }): NotionInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--cell-lines",
    got,
    message: `--cell-lines must be a positive whole number of lines, not ${JSON.stringify(got)}`,
  }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): NotionFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  pageAddressInvalid: ({ cause }: { cause: NotionLiveError }): NotionPageAddressInvalidError => ({
    cause,
    code: "PAGE_ADDRESS_INVALID",
    message: cause.message,
  }),
  pageIdNotCanonical: ({ id }: { id: string }): NotionPageIdNotCanonicalError => ({
    code: "PAGE_ID_NOT_CANONICAL",
    id,
    message: `"${id}" is not a canonical Notion UUID, and it would reach a ledger filename`,
  }),
  pageUsage: ({ got, verbs }: { got: string | undefined; verbs: readonly string[] }): NotionUnknownSubcommandError => ({
    code: "UNKNOWN_SUBCOMMAND",
    got,
    message: `usage: slopweaver notion page <${verbs.join("|")}> --body <md-path|-> [...]`,
  }),
  tooManyAddresses: ({ count }: { count: number }): NotionTooManyAddressesError => ({
    code: "TOO_MANY_ADDRESSES",
    count,
    message: "notion verify checks ONE page; pass a single address",
  }),
  verifyAddressMissing: (): NotionAddressMissingError => ({
    code: "ADDRESS_MISSING",
    message:
      "usage: slopweaver notion verify <page-id-or-url> [--observation <path|->] [--out <dir>] [--cell-lines <n>]",
  }),
} as const;

/**
 * The lines a {@link NotionCommandError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function notionCommandErrorLines({ error }: { error: NotionCommandError }): readonly string[] {
  if (error.code === "FLAGS_INVALID" || error.code === "ARGS_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
