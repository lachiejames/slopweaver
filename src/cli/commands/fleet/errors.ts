/**
 * The typed failures the `fleet` verbs author: a flag value a pure parser refused, the config file `fleet
 * restore-policy` could not read as UTF-8 text, and the three ways a recovery pass fails to open. Scoped to this verb
 * directory per `.claude/rules/error-handling.md`.
 *
 * {@link fleetCommandErrorLines} prints an argument refusal one reason per line and every other variant as its single
 * message, so a verb that joins the lines with `; ` prints byte for byte what it printed when these were string lists.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** One flag was given a value the verb does not accept; `flag` names it and `got` is what arrived. */
export interface FleetFlagValueInvalidError {
  readonly code: "FLAG_VALUE_INVALID";
  readonly message: string;
  readonly flag: string;
  readonly got: string | undefined;
}

/** A parser refused one or more flag values at once; `problems` carries each and `reasons` their messages in order. */
export interface FleetArgumentsRefusedError {
  readonly code: "ARGUMENTS_REFUSED";
  readonly message: string;
  readonly problems: readonly FleetFlagValueInvalidError[];
  readonly reasons: readonly string[];
}

/** The flag tokeniser refused the tail; `reasons` is its own list. */
export interface FleetFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The config file could not be read; `path` names it. */
export interface FleetConfigReadFailedError {
  readonly code: "CONFIG_READ_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The config file's bytes are not strict UTF-8. */
export interface FleetConfigInvalidUtf8Error {
  readonly code: "CONFIG_INVALID_UTF8";
  readonly message: string;
  readonly path: string;
}

/** The fleet lock could not be taken for a recovery pass. */
export interface FleetLockUnavailableError {
  readonly code: "FLEET_LOCK_UNAVAILABLE";
  readonly message: string;
  readonly cause: { readonly message: string };
}

/** The recovery journal would not be read. */
export interface FleetResumeJournalReadFailedError {
  readonly code: "RESUME_JOURNAL_READ_FAILED";
  readonly message: string;
  readonly cause: { readonly message: string };
}

/** The recovery journal would not take the attempt's start. */
export interface FleetResumeStartJournalFailedError {
  readonly code: "RESUME_START_JOURNAL_FAILED";
  readonly message: string;
  readonly cause: { readonly message: string };
}

/** Every failure the `fleet` verbs author. */
export type FleetCommandError =
  | FleetFlagValueInvalidError
  | FleetArgumentsRefusedError
  | FleetFlagsRefusedError
  | FleetConfigReadFailedError
  | FleetConfigInvalidUtf8Error
  | FleetLockUnavailableError
  | FleetResumeJournalReadFailedError
  | FleetResumeStartJournalFailedError;

/** The factory the verbs call, so a test built the same way catches a drift. */
export const FleetCommandErrors = {
  argumentsRefused: ({ problems }: { problems: readonly FleetFlagValueInvalidError[] }): FleetArgumentsRefusedError => {
    const reasons = problems.map((problem) => problem.message);
    return { code: "ARGUMENTS_REFUSED", message: reasons.join("; "), problems, reasons };
  },
  configInvalidUtf8: ({ path }: { path: string }): FleetConfigInvalidUtf8Error => ({
    code: "CONFIG_INVALID_UTF8",
    message: "it is not valid UTF-8, and a rewrite would replace the bytes that are not",
    path,
  }),
  configReadFailed: ({ path, cause }: { path: string; cause: unknown }): FleetConfigReadFailedError => ({
    cause,
    code: "CONFIG_READ_FAILED",
    message: errorMessage({ error: cause }),
    path,
  }),
  daysOutOfRange: ({ got, max }: { got: string | undefined; max: number }): FleetFlagValueInvalidError => ({
    code: "FLAG_VALUE_INVALID",
    flag: "--days",
    got,
    message: `--days must be a whole number from 1 to ${String(max)}, got ${String(got)}`,
  }),
  flagsRefused: ({ reasons }: { reasons: readonly string[] }): FleetFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  lockUnavailable: ({ cause }: { cause: { readonly message: string } }): FleetLockUnavailableError => ({
    cause,
    code: "FLEET_LOCK_UNAVAILABLE",
    message: cause.message,
  }),
  minutesOutOfRange: ({ got, max }: { got: string | undefined; max: number }): FleetFlagValueInvalidError => ({
    code: "FLAG_VALUE_INVALID",
    flag: "--minutes",
    got,
    message: `--minutes must be a whole number from 1 to ${String(max)}, got ${String(got)}`,
  }),
  nowNotIso: ({ got }: { got: string }): FleetFlagValueInvalidError => ({
    code: "FLAG_VALUE_INVALID",
    flag: "--now",
    got,
    message: `--now ${got} is not an ISO-8601 instant`,
  }),
  recordReadingNeedsJson: ({ got }: { got: string }): FleetFlagValueInvalidError => ({
    code: "FLAG_VALUE_INVALID",
    flag: "--record-reading",
    got,
    message: "--record-reading records the --json document, so it needs --json",
  }),
  resumeJournalReadFailed: ({ cause }: { cause: { readonly message: string } }): FleetResumeJournalReadFailedError => ({
    cause,
    code: "RESUME_JOURNAL_READ_FAILED",
    message: cause.message,
  }),
  resumeStartJournalFailed: ({
    cause,
  }: {
    cause: { readonly message: string };
  }): FleetResumeStartJournalFailedError => ({
    cause,
    code: "RESUME_START_JOURNAL_FAILED",
    message: `the recovery journal would not take this attempt's start, so nothing was touched: ${cause.message}`,
  }),
} as const;

/**
 * The lines a refused invocation prints: an argument or tokeniser refusal one reason per line, any other variant its
 * single message.
 *
 * @returns the diagnostic lines, byte for byte what the verbs have always printed
 */
export function fleetCommandErrorLines({ error }: { error: FleetCommandError }): readonly string[] {
  if (error.code === "ARGUMENTS_REFUSED" || error.code === "FLAGS_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
