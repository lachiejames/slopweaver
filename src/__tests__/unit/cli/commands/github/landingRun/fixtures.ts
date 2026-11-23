/**
 * Shared fixtures for the `runGithubLanding` suites: one live pull request nothing is holding, the head it stands at,
 * and the store outages the landing registers answer with.
 */
import { DISTANCE_NOT_REQUESTED } from "../../../../../../live/github/baseDistance.js";
import type { PrLivePage, PrLiveState } from "../../../../../../live/github/reviewState.js";
import { githubMergeStatus } from "../../../../../../review/githubMergeStatus.js";
import { PressJournalErrors } from "../../../../../../review/pressJournalErrors.js";
import { ReadJournalErrors } from "../../../../../../review/readJournalErrors.js";

/** The head every fixture pull request stands at unless a case moves it. */
export const HEAD = "1111111111111111111111111111111111111111";

/** What each landing register answers when the store is down. */
export const STORE_OUTAGE = {
  presses: PressJournalErrors.storeUnavailable({ doing: "be opened", reason: "connect ECONNREFUSED (a fixture)" }),
  reads: ReadJournalErrors.storeUnavailable({ doing: "be opened", reason: "connect ECONNREFUSED (a fixture)" }),
};

/** The one passing required check a fixture pull request carries. */
export const PASSING = { kind: "check-run", name: "build", state: "passed", url: undefined } as const;

/**
 * A live pull request nothing is holding, with the fields a test cares about overridden.
 *
 * @returns the fixture pull request with `over` spread on top
 */
export const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "the-owner",
  baseRefName: "staging",
  changedPaths: ["src/app.ts"],
  changedPathsTruncated: false,
  checks: {
    baseRef: "staging",
    checks: [PASSING],
    headSha: HEAD,
    mergeable: undefined,
    residue: [],
    rollupState: "SUCCESS",
    supersededChecks: [],
    truncated: false,
  },
  baseDistance: DISTANCE_NOT_REQUESTED,
  checksRead: { kind: "read" },
  headRepoSlug: "acme/widgets",
  checksTruncated: false,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  createdAtIso: "2026-09-01T00:00:00Z",
  defaultBranch: "staging",
  headOid: HEAD,
  headRefName: "feature/one",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  githubMergeStatus: githubMergeStatus({ value: "CLEAN" }),
  number: 16378,
  queueEntry: undefined,
  repoSlug: "acme/widgets",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a change",
  updatedAtIso: "2026-09-09T12:00:00Z",
  url: "https://github.com/acme/widgets/pull/16378",
  ...over,
});

/**
 * One fleet page carrying every given pull request and no next cursor.
 *
 * @returns a single-page fleet read
 */
export const onePage = ({ prs }: { prs: readonly PrLiveState[] }): readonly PrLivePage[] => [
  { nextCursor: undefined, pullRequests: prs, totalCount: prs.length },
];

/**
 * One of the OWNER's OWN `--self-review` walkthrough threads: the owner opened it, they are the only voice, nobody replied.
 *
 * @returns the review thread
 */
export const ownThread = ({ id = "PRRT_own1" }: { id?: string }): PrLiveState["threads"][number] => ({
  commentCount: 1,
  id,
  isOutdated: false,
  isResolved: false,
  lastCommentAtIso: "2026-09-09T11:00:00Z",
  lastCommentBody: "",
  lastCommentLogin: "the-owner",
  line: 12,
  openedAtIso: "2026-09-09T11:00:00Z",
  openedByLogin: "the-owner",
  openerBody: "",
  path: "src/app.ts",
});
