/**
 * The typed failures of parsing one `<provider> read` invocation, before any credential or network is touched.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this directory's argument parser and
 * separate from each provider's live-read union (`live/{github,linear,notion}/errors.ts`): those name what a
 * PROVIDER said, these name what the COMMAND LINE got wrong, and every one of them exits with the usage text.
 */
import type { LinearLiveError } from "../../../live/linear/errors.js";
import type { ProviderReadSource } from "../../../live/providerRead.js";

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface ProviderReadFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** No positional address was given, so there is no object to read. */
export interface ProviderReadAddressMissingError {
  readonly code: "ADDRESS_MISSING";
  readonly message: string;
  readonly provider: ProviderReadSource;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface ProviderReadInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** `--after` was combined with `--kind database`, whose read never lists block children to continue. */
export interface ProviderReadAfterOnDatabaseError {
  readonly code: "AFTER_ON_DATABASE";
  readonly message: string;
}

/** Linear's reader refused `--include`; `cause` is its own error, whose message is forwarded unchanged. */
export interface ProviderReadIncludeInvalidError {
  readonly code: "INCLUDE_INVALID";
  readonly message: string;
  readonly cause: LinearLiveError;
}

/** `--files` was given for an address that is not a pull request — an issue or a discussion changes no files. */
export interface ProviderReadFilesNotPullRequestError {
  readonly code: "FILES_NOT_A_PULL_REQUEST";
  readonly message: string;
}

/** Every way parsing one `<provider> read` invocation can fail. */
export type ProviderReadArgsError =
  | ProviderReadFlagsInvalidError
  | ProviderReadAddressMissingError
  | ProviderReadInvalidFlagValueError
  | ProviderReadAfterOnDatabaseError
  | ProviderReadIncludeInvalidError
  | ProviderReadFilesNotPullRequestError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ProviderReadArgsErrors = {
  addressMissing: ({ provider }: { provider: ProviderReadSource }): ProviderReadAddressMissingError => ({
    code: "ADDRESS_MISSING",
    message: `a ${provider} object address is required`,
    provider,
  }),
  afterEmpty: ({ got }: { got: string }): ProviderReadInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--after",
    got,
    message: "--after must be the non-empty nextCursor from a previous read",
  }),
  mediaOutEmpty: ({ got }: { got: string }): ProviderReadInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--media-out",
    got,
    message: "--media-out must name the directory the body's pictures and videos are written into",
  }),
  // The value is deliberately NOT echoed: an address pasted here may be a signed link carrying its token.
  mediaOutAddress: (): ProviderReadInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--media-out",
    got: "(an address)",
    message: "--media-out takes a local directory, not an address",
  }),
  afterOnDatabase: (): ProviderReadAfterOnDatabaseError => ({
    code: "AFTER_ON_DATABASE",
    message: "--after applies to a page's top-level blocks; a database read does not list block children",
  }),
  nestedCallsOnDatabase: ({ got }: { got: string }): ProviderReadInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--nested-calls",
    got,
    message: "--nested-calls bounds a page's nested blocks; a database read does not list block children",
  }),
  nestedCallsOutOfRange: ({ got, max }: { got: string; max: number }): ProviderReadInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--nested-calls",
    got,
    message: `--nested-calls must be an integer from 1 to ${String(max)}`,
  }),
  filesNotPullRequest: (): ProviderReadFilesNotPullRequestError => ({
    code: "FILES_NOT_A_PULL_REQUEST",
    message: "--files reads the files a pull request changes; give a https://github.com/<owner>/<repo>/pull/<n> link",
  }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): ProviderReadFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  includeInvalid: ({ cause }: { cause: LinearLiveError }): ProviderReadIncludeInvalidError => ({
    cause,
    code: "INCLUDE_INVALID",
    message: cause.message,
  }),
  kindUnknown: ({ got }: { got: string }): ProviderReadInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--kind",
    got,
    message: `--kind must be page or database, got ${got}`,
  }),
  limitOutOfRange: ({ got, max }: { got: string; max: number }): ProviderReadInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit must be an integer from 1 to ${String(max)}`,
  }),
} as const;

/**
 * The lines a {@link ProviderReadArgsError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function providerReadArgsErrorLines({ error }: { error: ProviderReadArgsError }): readonly string[] {
  if (error.code === "FLAGS_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
