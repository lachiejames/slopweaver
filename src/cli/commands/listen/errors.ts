/**
 * The typed failures `slopweaver listen` and `listen recover` author themselves while reading their flags: a
 * value a flag does not accept, a flag given with no value, a flag given in a mode it has no meaning in, and
 * the required flags `listen recover` cannot sweep without.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. The flag
 * tokeniser's own refusals (`parseFlags`) and `live/listen`'s scope refusals are not re-authored here: they
 * arrive as their own string lists and are printed as they came.
 */

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface ListenInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** A string flag was passed with no value after it. */
export interface ListenFlagValueMissingError {
  readonly code: "FLAG_VALUE_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A flag was given in a mode it has no meaning in, or together with a flag it contradicts. */
export interface ListenFlagCombinationRefusedError {
  readonly code: "FLAG_COMBINATION_REFUSED";
  readonly message: string;
  readonly flag: string;
}

/**
 * `listen recover` was not given one or more of the flags it cannot sweep without. Every one is reported at
 * once, one line each, so the caller can fix them together.
 */
export interface ListenRequiredFlagsMissingError {
  readonly code: "REQUIRED_FLAGS_MISSING";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure this verb directory authors. */
export type ListenError =
  | ListenInvalidFlagValueError
  | ListenFlagValueMissingError
  | ListenFlagCombinationRefusedError
  | ListenRequiredFlagsMissingError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ListenErrors = {
  deadlineNotPositive: ({ got }: { got: string }): ListenInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--deadline-ms",
    got,
    message: `--deadline-ms must be a positive integer number of milliseconds, got '${got}'`,
  }),
  deadlineOutsideEmitJson: (): ListenFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--deadline-ms",
    message: "--deadline-ms is only valid together with --emit --json, and never with --check or --follow",
  }),
  deadlineOutsideScheduledJson: (): ListenFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--deadline-ms",
    message: "--deadline-ms is only valid together with --scheduled --json",
  }),
  deadlineValueMissing: (): ListenFlagValueMissingError => ({
    code: "FLAG_VALUE_MISSING",
    flag: "--deadline-ms",
    message: "--deadline-ms requires a value",
  }),
  discoverWithScheduled: (): ListenFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--discover-channels",
    message: "--discover-channels is manual mode only — a --scheduled sweep already discovers its breadth",
  }),
  followWithOnce: (): ListenFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--follow",
    message:
      "--follow and --once are mutually exclusive: --follow stays connected indefinitely, --once stops after the first tag",
  }),
  heartbeatWithoutFollow: (): ListenFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--heartbeat",
    message: "--heartbeat is only valid with --follow: a one-shot listener has no liveness to supervise",
  }),
  recoverFlagsMissing: ({
    botUser,
    channels,
  }: {
    botUser: boolean;
    channels: boolean;
  }): ListenRequiredFlagsMissingError => {
    const reasons = [
      ...(botUser ? ["--bot-user is required"] : []),
      ...(channels ? ["--channels is required, naming at least one channel the bot may reply in"] : []),
    ];
    return { code: "REQUIRED_FLAGS_MISSING", message: reasons.join("; "), reasons };
  },
  scheduledWithoutJson: (): ListenFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--scheduled",
    message: "--scheduled requires --json",
  }),
  sinceUnreadable: ({ got }: { got: string }): ListenInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--since",
    got,
    message: `--since \`${got}\` is neither an ISO-8601 instant nor an \`Nd\` day count`,
  }),
} as const;

/**
 * The lines a {@link ListenError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function listenErrorLines({ error }: { error: ListenError }): readonly string[] {
  if (error.code === "REQUIRED_FLAGS_MISSING") {
    return error.reasons;
  }
  return [error.message];
}
