/**
 * Why an `identity roster` invocation was refused before anything was read: one variant per mistake a caller
 * can make, so a test and a caller branch on the code and display the message.
 */

/** The flag parser itself refused the argv (an unknown flag, a missing value). */
export interface RosterFlagsUnparsedError {
  readonly code: "ROSTER_FLAGS_UNPARSED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** No action, two actions, or one that is neither `show` nor `replace`. */
export interface RosterActionMissingError {
  readonly code: "ROSTER_ACTION_MISSING";
  readonly message: string;
}

/** `show` was handed `replace`'s write flags. */
export interface RosterShowTakesNoWriteFlagsError {
  readonly code: "ROSTER_SHOW_TAKES_NO_WRITE_FLAGS";
  readonly message: string;
}

/** `replace` lacks its document or the revision it pins to. */
export interface RosterReplaceUnpinnedError {
  readonly code: "ROSTER_REPLACE_UNPINNED";
  readonly message: string;
}

/** `--expect-revision` is neither `none` nor a positive whole revision. */
export interface RosterRevisionMalformedError {
  readonly code: "ROSTER_REVISION_MALFORMED";
  readonly message: string;
  readonly token: string;
}

/** Every refusal `identity roster`'s argv parse can return. */
export type IdentityRosterArgsError =
  | RosterActionMissingError
  | RosterFlagsUnparsedError
  | RosterReplaceUnpinnedError
  | RosterRevisionMalformedError
  | RosterShowTakesNoWriteFlagsError;

export const IdentityRosterArgsErrors = {
  actionMissing: (): RosterActionMissingError => ({
    code: "ROSTER_ACTION_MISSING",
    message: "identity roster takes exactly one action: `show` or `replace`",
  }),
  flagsUnparsed: ({ problems }: { problems: readonly string[] }): RosterFlagsUnparsedError => ({
    code: "ROSTER_FLAGS_UNPARSED",
    message: problems.join("; "),
    problems,
  }),
  replaceUnpinned: (): RosterReplaceUnpinnedError => ({
    code: "ROSTER_REPLACE_UNPINNED",
    message:
      "identity roster replace needs --file <path> and --expect-revision <n|none>: the revision is what " +
      "`identity roster show` printed, so a concurrent change is refused rather than overwritten",
  }),
  revisionMalformed: ({ noRowToken, token }: { noRowToken: string; token: string }): RosterRevisionMalformedError => ({
    code: "ROSTER_REVISION_MALFORMED",
    message: `--expect-revision takes a positive whole revision or \`${noRowToken}\`, not "${token}"`,
    token,
  }),
  showTakesNoWriteFlags: (): RosterShowTakesNoWriteFlagsError => ({
    code: "ROSTER_SHOW_TAKES_NO_WRITE_FLAGS",
    message: "identity roster show takes no --file or --expect-revision; those are replace's",
  }),
} as const;
