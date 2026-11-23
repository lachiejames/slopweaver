/**
 * The typed refusals the `drive` verbs' pure parsers author: a tail the flag tokeniser refused, a flag given a
 * value it does not accept, and a required positional missing. Scoped to this verb directory per
 * `.claude/rules/error-handling.md`, in the shape `../calendar/errors.ts` already uses for its sibling verbs.
 *
 * Every variant carries the usage of the verb whose tail it refused, so {@link driveErrorLines} prints each reason on
 * its own line and the usage last — byte for byte what the verbs printed when they returned a string list. The shared
 * Google connect shell still takes a string list, so `./connectRun.ts` adapts through the same renderer.
 */

/** The flag tokeniser refused the tail; `reasons` is its own list. */
export interface DriveFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
  readonly usage: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface DriveInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
  readonly usage: string;
}

/** A required positional was not given; `name` is its usage placeholder. */
export interface DriveArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
  readonly usage: string;
}

/** Every refusal a `drive` parser raises. */
export type DriveArgsError = DriveFlagsInvalidError | DriveInvalidFlagValueError | DriveArgumentMissingError;

/** The factory the parsers call, so a test built the same way catches a drift. */
export const DriveArgsErrors = {
  argumentMissing: ({ name, usage }: { name: string; usage: string }): DriveArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: `missing ${name}`,
    name,
    usage,
  }),
  flagsInvalid: ({ reasons, usage }: { reasons: readonly string[]; usage: string }): DriveFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
    usage,
  }),
  grantUnknown: ({
    got,
    choices,
    usage,
  }: {
    got: string;
    choices: readonly string[];
    usage: string;
  }): DriveInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--grant",
    got,
    message: `unknown --grant: ${got} (expected ${choices.join(" | ")})`,
    usage,
  }),
  limitOutOfRange: ({ got, max, usage }: { got: string; max: number; usage: string }): DriveInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit must be an integer between 1 and ${String(max)}`,
    usage,
  }),
} as const;

/**
 * The lines a refused tail prints: each reason on its own line, then the verb's usage.
 *
 * @returns the diagnostic lines, byte for byte what the verb has always printed
 */
export function driveErrorLines({ error }: { error: DriveArgsError }): readonly string[] {
  const reasons = error.code === "FLAGS_INVALID" ? error.reasons : [error.message];
  return [...reasons, error.usage];
}
