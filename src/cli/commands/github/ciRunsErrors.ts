/**
 * The usage problems this directory's CI-reading verbs can report, as a typed union rather than authored strings.
 *
 * A parse pass is the shape `error-handling.md` keeps on a LIST — its whole point is that one invocation
 * reports every problem it found, and one discriminated error would lose that multiplicity — so the result
 * carries `readonly GithubCiRunsUsageIssue[]`, not a single value. What the union buys is the other half:
 * `src/cli/commands/github` is a standing directory on the `error-shape-threshold` debt list, and a verb
 * authoring three fresh message literals into `err()` grows a list the owner's ruling says should be
 * shrinking. A message built by a factory is not a shape, so this verb adds none.
 */

/** `--runs` was outside the window GitHub's own `per_page` allows. */
interface RunWindowOutOfRangeIssue {
  readonly code: "RUN_WINDOW_OUT_OF_RANGE";
  readonly message: string;
  readonly max: number;
}

/** `--event` named a trigger this workflow read does not select on. */
interface UnknownEventIssue {
  readonly code: "UNKNOWN_EVENT";
  readonly message: string;
  readonly allowed: readonly string[];
}

/** A string flag was typed with an empty value — which is a mistake, never a request for the default. */
interface BlankFlagValueIssue {
  readonly code: "BLANK_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
}

/**
 * A string flag whose value, once trimmed, begins with `--` — so the parser would refuse it on the way
 * back in even though it accepted it on the way out.
 *
 * MEASURED by a review pass: `--baseline ' --baseline.json'` was accepted, trimmed to
 * `--baseline.json`, and then printed into a recovery command that exits 2 on `--baseline requires a
 * value`. `parseFlags.classifyFlagEntry` refuses any string value starting `--`, and the `=` spelling does
 * not escape it either, so such a value can be typed ONCE and never re-typed by a verb. Refusing it here
 * makes what this directory ACCEPTS the same set it can RE-EMIT, which is the property every printed
 * recovery in these verbs depends on.
 */
interface FlagValueLooksLikeFlagIssue {
  readonly code: "FLAG_VALUE_LOOKS_LIKE_FLAG";
  readonly message: string;
  readonly flag: string;
}

/** A problem the shared flag parser found, forwarded rather than re-worded. */
interface FlagParseIssue {
  readonly code: "FLAG_PARSE";
  readonly message: string;
}

/** No `--run-id` at all. The timing report reads ONE run, and guessing which one would report the wrong code. */
interface RunIdMissingIssue {
  readonly code: "RUN_ID_MISSING";
  readonly message: string;
}

/** A `--run-id` that was not a positive integer. GitHub run ids are integers, so anything else is a typo. */
interface RunIdNotNumericIssue {
  readonly code: "RUN_ID_NOT_NUMERIC";
  readonly message: string;
}

/** One thing wrong with a typed invocation of any of this directory's CI-reading verbs. */
export type GithubCiRunsUsageIssue =
  | RunWindowOutOfRangeIssue
  | UnknownEventIssue
  | BlankFlagValueIssue
  | FlagValueLooksLikeFlagIssue
  | FlagParseIssue
  | RunIdNotNumericIssue
  | RunIdMissingIssue;

/** Every usage problem this verb can report, built where its wording lives. */
export const GithubCiRunsUsageIssues = {
  blankFlagValue: ({ flag }: { flag: string }): BlankFlagValueIssue => ({
    code: "BLANK_FLAG_VALUE",
    flag,
    message: `--${flag} was given with no value`,
  }),
  flagParse: ({ message }: { message: string }): FlagParseIssue => ({ code: "FLAG_PARSE", message }),
  flagValueLooksLikeFlag: ({ flag, value }: { flag: string; value: string }): FlagValueLooksLikeFlagIssue => ({
    code: "FLAG_VALUE_LOOKS_LIKE_FLAG",
    flag,
    message:
      `--${flag} was given ${value}, which begins with -- and cannot be written back onto a command line: ` +
      `the flag parser refuses any string value starting --, in the spaced and the = spelling alike, so a ` +
      `recovery printing it would not run. Pass it as a path that does not lead with dashes instead`,
  }),
  runIdMissing: (): RunIdMissingIssue => ({
    code: "RUN_ID_MISSING",
    message: "--run-id is required; inside a workflow pass ${{ github.run_id }}",
  }),
  runIdNotNumeric: (): RunIdNotNumericIssue => ({
    code: "RUN_ID_NOT_NUMERIC",
    message: "--run-id must be a positive integer; inside a workflow it is $GITHUB_RUN_ID",
  }),
  runWindowOutOfRange: ({ max }: { max: number }): RunWindowOutOfRangeIssue => ({
    code: "RUN_WINDOW_OUT_OF_RANGE",
    max,
    message: `--runs must be an integer from 1 to ${String(max)}`,
  }),
  unknownEvent: ({ allowed }: { allowed: readonly string[] }): UnknownEventIssue => ({
    allowed,
    code: "UNKNOWN_EVENT",
    message: `--event must be one of ${allowed.join(", ")}`,
  }),
} as const;
