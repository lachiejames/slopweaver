/**
 * The usage problems `github run-log` can report, as a typed union rather than authored strings.
 *
 * Same reasoning as `./ciRunsErrors.ts`: a parse pass reports EVERY problem it found, so the result carries
 * a list rather than one discriminated value, and the union is what keeps `src/cli/commands/github` — a
 * standing `error-shape-threshold` directory — from growing a fresh authored shape per flag.
 */

/** The run id positional was absent, or was not a positive whole number. */
interface RunIdInvalidIssue {
  readonly code: "RUN_ID_INVALID";
  readonly message: string;
}

/** `--lines` was outside the window this verb keeps. */
interface TailLinesOutOfRangeIssue {
  readonly code: "TAIL_LINES_OUT_OF_RANGE";
  readonly message: string;
  readonly max: number;
}

/** A string flag was typed with an empty value — a mistake, never a request for the default. */
interface BlankFlagValueIssue {
  readonly code: "BLANK_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
}

/** A problem the shared flag parser found, forwarded rather than re-worded. */
interface FlagParseIssue {
  readonly code: "FLAG_PARSE";
  readonly message: string;
}

/** One thing wrong with a typed `github run-log` invocation. */
export type GithubRunLogUsageIssue =
  RunIdInvalidIssue | TailLinesOutOfRangeIssue | BlankFlagValueIssue | FlagParseIssue;

/** Every usage problem this verb can report, built where its wording lives. */
export const GithubRunLogUsageIssues = {
  blankFlagValue: ({ flag }: { flag: string }): BlankFlagValueIssue => ({
    code: "BLANK_FLAG_VALUE",
    flag,
    message: `--${flag} was given with no value`,
  }),
  flagParse: ({ message }: { message: string }): FlagParseIssue => ({ code: "FLAG_PARSE", message }),
  runIdInvalid: (): RunIdInvalidIssue => ({
    code: "RUN_ID_INVALID",
    message:
      "run-log needs one Actions run id as a positional, e.g. `slopweaver github run-log 35502228255` — " +
      "it is the number in an Actions URL's /actions/runs/<id>",
  }),
  tailLinesOutOfRange: ({ max }: { max: number }): TailLinesOutOfRangeIssue => ({
    code: "TAIL_LINES_OUT_OF_RANGE",
    max,
    message: `--lines must be an integer from 0 to ${String(max)}`,
  }),
} as const;
