/**
 * Why a `plans` invocation was refused before the register was touched: one variant per mistake a caller can
 * make on the command line, so a test and a caller branch on the code and display the message.
 */
/** The flag parser itself refused the argv (an unknown flag, a missing value). */
export interface PlansFlagsUnparsedError {
  readonly code: "PLANS_FLAGS_UNPARSED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** A flag the verb requires was not supplied. */
export interface PlansFlagMissingError {
  readonly code: "PLANS_FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A closed-list flag (`--provider`, `--percent`, `--allowance`) named something outside its list. */
export interface PlansFlagChoiceUnknownError {
  readonly code: "PLANS_FLAG_CHOICE_UNKNOWN";
  readonly message: string;
  readonly flag: string;
  readonly given: string;
}

/** `set-usage-limit` could not read its flags; every reason is kept, so one run names all of them. */
export interface PlansUsageLimitUnreadableError {
  readonly code: "PLANS_USAGE_LIMIT_UNREADABLE";
  readonly message: string;
  readonly problems: readonly string[];
}

/** `set-thresholds` could not read its flags; every reason is kept, so one run names all of them. */
export interface PlansThresholdsUnreadableError {
  readonly code: "PLANS_THRESHOLDS_UNREADABLE";
  readonly message: string;
  readonly problems: readonly string[];
}

/** `--store-dir` was relative, so it would address a different credential depending on the cwd. */
export interface PlansStoreDirRelativeError {
  readonly code: "PLANS_STORE_DIR_RELATIVE";
  readonly message: string;
  readonly storeDir: string;
}

/** `--on` was not a strict ISO-8601 instant. */
export interface PlansLapseInstantMalformedError {
  readonly code: "PLANS_LAPSE_INSTANT_MALFORMED";
  readonly message: string;
  readonly given: string;
}

/** The dispatched verb is not one the `plans` noun declares. */
export interface PlansVerbUnknownError {
  readonly code: "PLANS_VERB_UNKNOWN";
  readonly message: string;
  readonly verb: string;
}

/** Every refusal a `plans` verb's argv parse can return. */
export type PlansArgsError =
  | PlansFlagChoiceUnknownError
  | PlansFlagMissingError
  | PlansFlagsUnparsedError
  | PlansLapseInstantMalformedError
  | PlansStoreDirRelativeError
  | PlansThresholdsUnreadableError
  | PlansUsageLimitUnreadableError
  | PlansVerbUnknownError;

export const PlansArgsErrors = {
  flagChoiceUnknown: ({
    choices,
    flag,
    given,
  }: {
    choices: readonly (string | number)[];
    flag: string;
    given: string;
  }): PlansFlagChoiceUnknownError => ({
    code: "PLANS_FLAG_CHOICE_UNKNOWN",
    flag,
    given,
    message: `--${flag} must be one of ${choices.join(", ")}`,
  }),
  flagMissing: ({ flag }: { flag: string }): PlansFlagMissingError => ({
    code: "PLANS_FLAG_MISSING",
    flag,
    message: `--${flag} is required`,
  }),
  flagsUnparsed: ({ problems }: { problems: readonly string[] }): PlansFlagsUnparsedError => ({
    code: "PLANS_FLAGS_UNPARSED",
    message: problems.join("; "),
    problems,
  }),
  lapseInstantMalformed: ({ given }: { given: string }): PlansLapseInstantMalformedError => ({
    code: "PLANS_LAPSE_INSTANT_MALFORMED",
    given,
    message: `--on must be an ISO-8601 instant, such as 2026-11-17T00:00:00Z; got ${given}`,
  }),
  storeDirRelative: ({ storeDir }: { storeDir: string }): PlansStoreDirRelativeError => ({
    code: "PLANS_STORE_DIR_RELATIVE",
    message: "--store-dir must be an absolute path, because a provider CLI resolves it against its own cwd",
    storeDir,
  }),
  thresholdsUnreadable: ({ problems }: { problems: readonly string[] }): PlansThresholdsUnreadableError => ({
    code: "PLANS_THRESHOLDS_UNREADABLE",
    message: problems.join("; "),
    problems,
  }),
  usageLimitUnreadable: ({ problems }: { problems: readonly string[] }): PlansUsageLimitUnreadableError => ({
    code: "PLANS_USAGE_LIMIT_UNREADABLE",
    message: problems.join("; "),
    problems,
  }),
  verbUnknown: ({ verb }: { verb: string }): PlansVerbUnknownError => ({
    code: "PLANS_VERB_UNKNOWN",
    message: `unknown plans verb: ${verb}`,
    verb,
  }),
} as const;
