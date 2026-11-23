/**
 * The plain-fake edges every `github review-state` shell test runs over — no Octokit, Slack, corpus or clock.
 *
 * Shared by `../reviewStateRun.test.ts` and `../reviewStateRepositoryResolution.test.ts` rather than copied, so
 * the two files exercise the identical seams.
 */

import type { GithubReviewStateDeps } from "../../../../../../cli/commands/github/reviewStateRun.js";
import { err, ok, type Result } from "../../../../../../lib/result.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../../live/github/baseDistance.js";
import type { GithubChecksSnapshot } from "../../../../../../live/github/checks.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../../../live/github/errors.js";
import type { ResolvedGithubRepository } from "../../../../../../live/github/repositoryResolution.js";
import type { PrLivePage, PrLiveState } from "../../../../../../live/github/reviewState.js";
import type { SlackLiveSearchError } from "../../../../../../live/slack/searchErrors.js";
import type { SlackSearchPage } from "../../../../../../live/slack/searchMessages.js";
import { EMPTY_REVIEW_ROSTER } from "../../../../../../review/reviewRoster.js";
import type { SlackMention } from "../../../../../../review/slackEvidenceTypes.js";

/**
 * What GitHub's own message is when it declines a fleet page — the shape `parseFleetPage` names.
 *
 * Spelled out rather than shortened, because the halving tests assert that THIS sentence is what a reader
 * gets when the read is exhausted: a generic one would hide which of the four wire shapes fired.
 */
export const SEARCH_NULLED =
  "GitHub returned no search connection for the fleet read — GitHub answered `search: null`, which is how it declines a query it could not complete";

/** GitHub's own message on a rate-limited page, spelled out so the no-halving case can assert it arrived. */
export const RATE_LIMITED = "API rate limit exceeded for user ID 1";

/**
 * One live pull request, with the fields a test cares about overridden.
 *
 * @param over the fields to override
 * @returns the pull request
 */
export const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "author-login",
  baseRefName: "staging",
  changedPaths: ["apps/etl/main.ts"],
  changedPathsTruncated: false,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  labels: [],
  labelsTruncated: false,
  queueEntry: undefined,
  reviewsTruncated: false,
  checks: {
    baseRef: undefined,
    checks: [],
    headSha: "abc",
    mergeable: undefined,
    residue: [],
    rollupState: "PENDING",
    supersededChecks: [],
    truncated: false,
  },
  baseDistance: DISTANCE_NOT_REQUESTED,
  checksRead: { kind: "read" },
  headRepoSlug: "acme/widgets",
  checksTruncated: false,
  createdAtIso: "2026-08-28T00:00:00Z",
  defaultBranch: "staging",
  headRefName: "feature/one",
  headOid: "abc",
  isDraft: false,
  mergeable: "MERGEABLE",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  number: 1,
  repoSlug: "o/target",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a title",
  updatedAtIso: "2026-08-28T01:00:00Z",
  url: "https://github.com/o/target/pull/1",
  ...over,
});

/** A run's captured output, and the fakes that produced it. */
export interface Harness {
  readonly deps: GithubReviewStateDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly queries: string[];
  /** Every head the run asked the paged checks re-read about, as `owner/repo#number limit <n>`. */
  readonly completionAskedFor: string[];
  /** Every pull request the run asked the merge-tree seam about, as `owner/repo#number`. */
  readonly conflictPathsAskedFor: string[];
  /** The `pageSize` of every fleet request the run made, in order — the witness for the halving. */
  readonly pageSizes: number[];
  /** The `timeoutMs` every fleet request carried, in order — the witness for the per-request cap. */
  readonly timeouts: number[];
  /** Every repository the run asked the resolution seam about, in the order asked. */
  readonly resolutionAskedFor: string[];
  /** Every read past the fleet one — `codeowners <slug>`, `roster`, `required <slug>#<base>` — in order. */
  readonly downstream: string[];
}

/**
 * Build the injected edges over fixed pages, with no Octokit, Slack, corpus or clock.
 *
 * @returns the edges and every recorder a test asserts on
 */
// max-lines-exempt: one object literal of plain fakes, one per seam, moved verbatim out of a `.test.ts` the gate skips
export function harness({
  pages,
  mentions = [],
  slackLive = true,
  corpusIngested = true,
  corpusThrough = "2026-08-29T00:00:00Z",
  codeownersContent = "* @org/eng\n",
  recheck,
  corpusUnreadable = false,
  livePages = [],
  answersAtOrBelow,
  required = [],
  fleetRequestMs = 0,
  declinedFromRequest,
  rateLimited = false,
  wholeChecks = err(GithubLiveErrors.readFailed({ message: "this fixture carries no whole check list" })),
  resolutions = new Map(),
}: {
  pages: readonly PrLivePage[];
  mentions?: readonly SlackMention[];
  slackLive?: boolean;
  corpusIngested?: boolean;
  corpusThrough?: string;
  codeownersContent?: string;
  /** What the mergeability re-read answers, positionally, for the pull requests that came back UNKNOWN. */
  recheck?: readonly { kind: "read"; value: { mergeable: string; headOid: string } }[];
  /** Whether listing the Slack bronze fails, the way an unreadable directory does. */
  corpusUnreadable?: boolean;
  /** What the live search answers for page 1, 2, … — empty means one empty page. */
  livePages?: readonly Result<SlackSearchPage, SlackLiveSearchError>[];
  /**
   * The smallest `pageSize` GitHub will answer; any larger request errs the way a timed-out search does.
   *
   * Absent — the real behaviour for a fleet GitHub can serve — every page size answers. A number makes the
   * fake behave like a large repository: expensive enough that a wide page is refused
   * and a narrow one is not.
   */
  answersAtOrBelow?: number;
  /**
   * What every base branch in the run requires.
   *
   * Empty by default — see the seam below. A test naming a context is testing the GATE, and the gate is a
   * per-HEAD judgement even though this read is per-base, which is the whole subject of the false-red case.
   */
  required?: readonly string[];
  /**
   * How far the monotonic clock moves while each fleet request is in flight. Zero by default, so every other case
   * reads the fleet in no time at all and the budget never comes into it. The wall clock `now()` never moves, so
   * a budget measured on it instead would never expire and every budget case would fail.
   */
  fleetRequestMs?: number;
  /** Every fleet request from this one on (zero-based) is declined the way a timed-out search is. */
  declinedFromRequest?: number;
  /** Every fleet request is refused on GitHub's rate limit. */
  rateLimited?: boolean;
  /** What the paged checks re-read answers for a truncated head; a read failure by default. */
  wholeChecks?: Result<GithubChecksSnapshot, GithubLiveError>;
  /** What the resolution seam answers per slug; a slug absent here resolves to itself. */
  resolutions?: ReadonlyMap<string, Result<ResolvedGithubRepository, GithubLiveError>>;
}): Harness {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const queries: string[] = [];
  const conflictPathsAskedFor: string[] = [];
  const pageSizes: number[] = [];
  const timeouts: number[] = [];
  const completionAskedFor: string[] = [];
  const resolutionAskedFor: string[] = [];
  const downstream: string[] = [];
  let page = 0;
  let clockMs = 0;
  const deps: GithubReviewStateDeps = {
    api: () => ({
      codeowners: ({ owner, repo }) => {
        downstream.push(`codeowners ${owner}/${repo}`);
        return Promise.resolve(ok({ content: codeownersContent, path: "CODEOWNERS" }));
      },
      fleetPage: ({ query, pageSize, timeoutMs }) => {
        const request = pageSizes.length;
        pageSizes.push(pageSize);
        timeouts.push(timeoutMs);
        clockMs += fleetRequestMs;
        if (rateLimited) {
          return Promise.resolve(err(GithubLiveErrors.rateLimited({ message: RATE_LIMITED, resetAt: undefined })));
        }
        const declined = declinedFromRequest !== undefined && request >= declinedFromRequest;
        if (declined || (answersAtOrBelow !== undefined && pageSize > answersAtOrBelow)) {
          return Promise.resolve(err(GithubLiveErrors.readFailed({ message: SEARCH_NULLED })));
        }
        queries.push(query);
        const current = pages[page]!;
        page += 1;
        return Promise.resolve(ok(current));
      },
      // The single-pull-request seam answers off the SAME fixture pages, so a `--number` test exercises the
      // identical shaping code the fleet path does — which is the property the shared node selection buys.
      pr: ({ number }) => {
        const found = pages.flatMap((one) => one.pullRequests).find((one) => one.number === number);
        if (found === undefined) {
          return Promise.resolve(ok(pages[0]!.pullRequests[0]!));
        }
        return Promise.resolve(ok(found));
      },
    }),
    checksCompletion:
      () =>
      ({ owner, repo, number, limit }) => {
        completionAskedFor.push(`${owner}/${repo}#${String(number)} limit ${String(limit)}`);
        return Promise.resolve(wholeChecks);
      },
    // Every base branch reads as requiring whatever `required` names, empty by default: most tests here
    // assert the fleet shaping and the Slack legs, and a gate that varied per test would make each row's CI
    // clause depend on a fixture nobody is asserting. The false-red case names one context on purpose.
    requiredContexts: ({ owner, repo, branch }) => {
      downstream.push(`required ${owner}/${repo}#${branch}`);
      return Promise.resolve(ok(required));
    },
    baseDistances:
      () =>
      ({ subjects }) =>
        Promise.resolve(
          subjects.map(() => ({ kind: "read", value: { aheadBy: 1, behindBy: 3, status: "DIVERGED" } }) as const),
        ),
    mergeableRecheck:
      () =>
      ({ subjects }) => {
        if (recheck !== undefined) {
          return Promise.resolve(recheck);
        }
        return Promise.resolve(
          subjects.map(
            (subject) => ({ kind: "read", value: { headOid: subject.headOid, mergeable: "MERGEABLE" } }) as const,
          ),
        );
      },
    conflictPaths: ({ repoSlug, number }) => {
      conflictPathsAskedFor.push(`${repoSlug}#${String(number)}`);
      return { kind: "paths", paths: ["package.json"] };
    },
    corpusMentions: () =>
      corpusUnreadable ? err(["the Slack bronze at /x could not be listed: EACCES"]) : ok(mentions),
    slackIdentity: () => ({ ownerSlackUserId: "U1", selfUserIds: [] }),
    corpusThrough: () => (corpusIngested ? corpusThrough : undefined),
    monotonicMs: () => clockMs,
    pageDeadline: () => new Promise(() => undefined),
    now: () => new Date("2026-08-30T12:00:00.000Z"),
    resolveRepo: () => ok({ owner: "o", repo: "r" }),
    resolveRepository: ({ repoSlug }) => {
      resolutionAskedFor.push(repoSlug);
      const answer = resolutions.get(repoSlug);
      if (answer === undefined) {
        return Promise.resolve(ok({ nameWithOwner: repoSlug }));
      }
      return Promise.resolve(answer);
    },
    roster: () => {
      downstream.push("roster");
      return Promise.resolve(ok(EMPTY_REVIEW_ROSTER));
    },
    slackConversations: () => undefined,
    askReadings: () => ok(new Map()),
    slackSearch: () =>
      slackLive
        ? ({ page: pageNumber }) => {
            const answer = livePages[pageNumber - 1];
            if (answer === undefined) {
              return Promise.resolve(ok({ matches: [], pageCount: 1, total: 0 }));
            }
            return Promise.resolve(answer);
          }
        : undefined,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return {
    completionAskedFor,
    conflictPathsAskedFor,
    deps,
    diagnostics,
    downstream,
    out,
    pageSizes,
    queries,
    resolutionAskedFor,
    timeouts,
  };
}
