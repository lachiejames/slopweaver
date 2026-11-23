/**
 * `slopweaver github review-state` — the pure argument handling and the GitHub search query it builds.
 *
 * Repo resolution against the current checkout is impure and lives in `./reviewStateRun.ts`; this module only
 * decides what was TYPED. The query builder is here rather than there because the query IS the selection
 * contract — which pull requests the seven questions get asked about — and a selection nobody can unit-test is
 * a selection nobody can trust.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { CHECK_PAGE } from "../../../live/github/reviewState.js";
import { positiveIntFlag } from "../../optionParsers.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many pull requests one search page asks for. Kept small deliberately — see the live seam's own note. */
const DEFAULT_PAGE_SIZE = 20;

/** The default ceiling on how many pull requests one invocation reads. */
const DEFAULT_LIMIT = 100;

/** GitHub's own hard ceiling on a search result set, whatever `--limit` asks for. */
export const SEARCH_RESULT_CEILING = 1000;

/**
 * How many check contexts one pull request's rollup is asked for, unless `--check-limit` says otherwise.
 *
 * The read layer's own `CHECK_PAGE` rather than a number of this verb's own: it was 60 here while the
 * landing read asked for 100, so the two surfaces reported different check sets for the same pull request
 * and only one of them said so. The measurement, and why 100 is a ceiling rather than a choice, is where
 * that constant is declared.
 */
const DEFAULT_CHECK_LIMIT = CHECK_PAGE;

/** How many changed paths one pull request is asked for, before CODEOWNERS matching goes partial. */
const DEFAULT_FILE_LIMIT = 100;

/**
 * The flags this verb accepts, exported for the repo-wide help-truth ratchet.
 *
 * @internal
 */
export const GITHUB_REVIEW_STATE_FLAGS: FlagSpec = {
  boolean: ["include-drafts", "no-slack-live", "json", "detail"],
  string: ["repo", "author", "number", "limit", "check-limit", "file-limit", "home"],
};

/**
 * Every accepted flag, with the `--` callers type.
 *
 * @internal
 */
export const GITHUB_REVIEW_STATE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_REVIEW_STATE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_REVIEW_STATE_FLAGS }),
].map((name) => `--${name}`);

/** A parsed, side-effect-free review-state invocation. `repos` is empty when none was typed. */
export interface GithubReviewStateArgs {
  readonly repos: readonly string[];
  readonly author: string | undefined;
  readonly includeDrafts: boolean;
  /** Select ONLY drafts, server-side (`draft:true`) — `github landing --drafts-only`. Absent, drafts follow {@link includeDrafts}. */
  readonly draftsOnly?: boolean;
  readonly slackLive: boolean;
  /**
   * Whether to spend one extra request measuring how far each head is behind its base.
   *
   * `github landing` asks for it because the owner wants it on every boot row; `github review-state`
   * and the session-start leg do not, because nothing they print reads it. Required rather than defaulted so
   * a new caller has to decide rather than inherit — `../../../live/github/baseDistance.ts` carries what the
   * request costs.
   */
  readonly readBaseDistance: boolean;
  readonly limit: number;
  readonly pageSize: number;
  readonly checkLimit: number;
  readonly fileLimit: number;
  readonly json: boolean;
  readonly home: string | undefined;
  /**
   * One pull-request number, when the caller named one — the single-pull-request mode.
   *
   * Read through `repository.pullRequest` rather than through search, with the IDENTICAL node selection, so
   * a reader who names one pull request sees exactly what its row in the table was computed from.
   */
  readonly number: number | undefined;
  /**
   * Whether to print the granular per-pull-request block, and therefore whether to READ comment bodies.
   *
   * One flag for both because they are one decision: the bodies are the expensive half of the read and the
   * block is the only thing that prints them, so asking for one without the other is either a wasted payload
   * or a block with its quotes missing. `--number` implies it — a reader who named one pull request has
   * already chosen the detailed answer.
   */
  readonly detail: boolean;
}

/**
 * Parse one `github review-state` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github review-state`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubReviewStateArgs({ rest }: { rest: readonly string[] }): Result<GithubReviewStateArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_REVIEW_STATE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const limit = positiveIntFlag({ fallback: DEFAULT_LIMIT, name: "limit", problems, values });
  const checkLimit = positiveIntFlag({ fallback: DEFAULT_CHECK_LIMIT, name: "check-limit", problems, values });
  const fileLimit = positiveIntFlag({ fallback: DEFAULT_FILE_LIMIT, name: "file-limit", problems, values });
  const repoValue = values["repo"];
  const repos = typeof repoValue === "string" ? repoValue.split(",").map((slug) => slug.trim()) : [];
  if (repos.some((slug) => !slug.includes("/"))) {
    problems.push("--repo takes one or more comma-separated owner/name slugs");
  }
  const number =
    values["number"] === undefined ? undefined : positiveIntFlag({ fallback: 0, name: "number", problems, values });
  if (number !== undefined && repos.length !== 1) {
    problems.push("--number names one pull request, so it needs exactly one --repo <owner/name>");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const author = values["author"];
  const home = values["home"];
  return ok({
    author: typeof author === "string" ? author : undefined,
    checkLimit,
    detail: values["detail"] === true || number !== undefined,
    fileLimit,
    home: typeof home === "string" ? home : undefined,
    includeDrafts: values["include-drafts"] === true,
    json: values["json"] === true,
    limit,
    number,
    pageSize: Math.min(DEFAULT_PAGE_SIZE, limit),
    repos,
    readBaseDistance: false,
    slackLive: values["no-slack-live"] !== true,
  });
}

/**
 * The GitHub search query the fleet read selects with.
 *
 * `draft:false` is a SERVER-side filter rather than a client-side one on purpose: a drafts-excluded run that
 * pages 358 open pull requests to keep 35 of them spends the whole budget on rows it throws away, and the
 * rollup field is what makes each of those rows expensive.
 *
 * @param repos the repository slugs to scope to
 * @param author the author login to scope to, when one was given
 * @param includeDrafts whether draft pull requests are wanted
 * @param draftsOnly whether ONLY draft pull requests are wanted, which wins over `includeDrafts`
 * @returns the query string, in GitHub's own search syntax
 */
export function buildReviewStateQuery({
  repos,
  author,
  includeDrafts,
  draftsOnly = false,
}: {
  repos: readonly string[];
  author: string | undefined;
  includeDrafts: boolean;
  draftsOnly?: boolean;
}): string {
  const parts = ["is:pr", "is:open", "sort:updated-desc"];
  for (const slug of repos) {
    parts.push(`repo:${slug}`);
  }
  if (author !== undefined) {
    parts.push(`author:${author}`);
  }
  if (draftsOnly) {
    parts.push("draft:true");
  } else if (!includeDrafts) {
    parts.push("draft:false");
  }
  return parts.join(" ");
}
