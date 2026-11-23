/**
 * The failure kinds `slopweaver refresh` authors itself, as typed discriminated unions scoped to this
 * directory — no shared base type with any other domain (`.claude/rules/error-handling.md`).
 *
 * Each factory computes its own `message`, so a call site never hand-assembles the text a reader sees. A
 * failure authored ELSEWHERE (a repository resolution, a store read) rides in a `reasons` field rather than
 * being re-authored here.
 */

/** A `--source` value named something this build cannot fetch. */
export interface RefreshUnknownSourceError {
  readonly code: "UNKNOWN_SOURCE";
  readonly message: string;
  /** Every named source that was not fetchable, in the order they were typed. */
  readonly unknown: readonly string[];
  /** The sources this build does fetch, as the refusal advertises them. */
  readonly expected: readonly string[];
}

/** A window was planned for `self`, which is a local re-scan with no cursor rather than a fetched source. */
export interface RefreshSelfNotFetchableError {
  readonly code: "SELF_NOT_FETCHABLE";
  readonly message: string;
}

/** A source whose ingest lane is injected was requested, and this build injected none. */
export interface RefreshLaneNotWiredError {
  readonly code: "LANE_NOT_WIRED";
  readonly message: string;
  readonly source: UnwiredLaneSource;
}

/** The GitHub job builder refused — its repository or org could not be resolved. */
export interface RefreshGithubJobUnbuildableError {
  readonly code: "GITHUB_JOB_UNBUILDABLE";
  readonly message: string;
  /** What the builder reported, verbatim. */
  readonly reasons: readonly string[];
}

/** The Notion grant-delta backfill threw before the incremental crawl could start. */
export interface RefreshNotionGrantDeltaFailedError {
  readonly code: "NOTION_GRANT_DELTA_FAILED";
  readonly message: string;
  /** The thrown error's own message, or `unknown` when what was thrown was not an `Error`. */
  readonly detail: string;
}

/** The sources whose lane is an optional injected builder, each named by what it ingests. */
const LANE_NOUN = {
  calendar: "diary",
  chatgpt: "chat-history",
  fathom: "recorded-call",
  gmail: "mail",
  "outlook-calendar": "Outlook diary",
} as const;

/** A source whose ingest lane may be absent from a build. */
export type UnwiredLaneSource = keyof typeof LANE_NOUN;

/** Every way resolving the job list for the planned windows can fail. */
export type RefreshJobPlanError =
  RefreshSelfNotFetchableError | RefreshLaneNotWiredError | RefreshGithubJobUnbuildableError;

/** Construct each refresh failure the same way the real code does. */
export const RefreshErrors = {
  githubJobUnbuildable: ({ reasons }: { reasons: readonly string[] }): RefreshGithubJobUnbuildableError => ({
    code: "GITHUB_JOB_UNBUILDABLE",
    message: reasons.join("; "),
    reasons,
  }),
  laneNotWired: ({ source }: { source: UnwiredLaneSource }): RefreshLaneNotWiredError => ({
    code: "LANE_NOT_WIRED",
    message: `refresh: ${source} was requested but this build has no ${LANE_NOUN[source]} ingest lane wired`,
    source,
  }),
  notionGrantDeltaFailed: ({ cause }: { cause: unknown }): RefreshNotionGrantDeltaFailedError => {
    const detail = cause instanceof Error ? cause.message : "unknown";
    return {
      code: "NOTION_GRANT_DELTA_FAILED",
      detail,
      message: `notion grant-delta backfill failed: ${detail}`,
    };
  },
  selfNotFetchable: (): RefreshSelfNotFetchableError => ({
    code: "SELF_NOT_FETCHABLE",
    message: "refresh: self is not a fetchable source — use --self (a full local re-scan, no cursor)",
  }),
  unknownSource: ({
    unknown,
    expected,
  }: {
    unknown: readonly string[];
    expected: readonly string[];
  }): RefreshUnknownSourceError => ({
    code: "UNKNOWN_SOURCE",
    expected,
    message: `unknown --source: ${unknown.join(", ")} (expected ${expected.join("|")})`,
    unknown,
  }),
} as const;
