/**
 * The typed failures of pointing the profiler at something — one bounded module, one union.
 *
 * Every one of these is a caller naming a subject the profiler cannot resolve: a gate that is not in the
 * registry, a lane that does not exist, a `--verb` with nothing after `--`, a numeric flag that is not a
 * number. They are authored here rather than as plain strings at their sites because `src/perf` went past
 * the `error-shape-threshold` gate's four-shape ceiling the moment the flag parsers joined it, which is
 * exactly the point that rule names: past four, a directory's failures have multiplied beyond what the
 * plain string list was kept for (error-handling.md).
 *
 * `code` is what a caller branches on; `message` is what it displays. Nothing here wraps an external call,
 * so there is no `IngestError` to map — these are all failures of what the operator typed.
 */

/** A `--gate`, `--lane` or `--verb` that named nothing the registry knows. */
export interface UnknownSubjectError {
  readonly code: "UNKNOWN_SUBJECT";
  readonly message: string;
  /** What the caller asked for. */
  readonly asked: string;
  /** What it could have asked for, sorted. */
  readonly known: readonly string[];
}

/** No subject named at all, or more than one — the two ways the three alternatives go wrong. */
export interface SubjectSelectionError {
  readonly code: "NO_SUBJECT" | "AMBIGUOUS_SUBJECT";
  readonly message: string;
}

/** `--verb` with an empty argv after `--`. */
export interface EmptyVerbError {
  readonly code: "EMPTY_VERB";
  readonly message: string;
}

/** A numeric flag whose value is not the number it has to be. */
export interface NumericFlagError {
  readonly code: "BAD_NUMERIC_FLAG";
  readonly message: string;
  /** The flag, `--`-prefixed. */
  readonly flag: string;
  /** What the caller passed, verbatim. */
  readonly value: string;
}

/** Every way a profiler subject fails to resolve. */
export type ProfileSubjectError = UnknownSubjectError | SubjectSelectionError | EmptyVerbError | NumericFlagError;

/** The factories the real code calls, so a test built the same way catches one that stops matching its type. */
export const ProfileSubjectErrors = {
  ambiguousSubject: (): SubjectSelectionError => ({
    code: "AMBIGUOUS_SUBJECT",
    message: "name exactly one subject: --gate, --lane and --verb are alternatives",
  }),
  badNumericFlag: ({ flag, value, must }: { flag: string; value: string; must: string }): NumericFlagError => ({
    code: "BAD_NUMERIC_FLAG",
    flag,
    message: `${flag} must be ${must}, got ${value}`,
    value,
  }),
  emptyVerb: (): EmptyVerbError => ({
    code: "EMPTY_VERB",
    message: "--verb needs a verb after `--`, e.g. `dev profile --verb -- catalog`",
  }),
  noSubject: (): SubjectSelectionError => ({
    code: "NO_SUBJECT",
    message: "name a subject: --gate <name>, --lane <name>, or --verb -- <argv...>",
  }),
  unknownSubject: ({
    kind,
    asked,
    known,
  }: {
    kind: string;
    asked: string;
    known: readonly string[];
  }): UnknownSubjectError => ({
    asked,
    code: "UNKNOWN_SUBJECT",
    known,
    message: `no ${kind} named ${asked}; known ${kind}s: ${known.join(", ")}`,
  }),
} as const;
