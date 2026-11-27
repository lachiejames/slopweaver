/** The shared fixtures `assembleReviewState`'s sibling test files build their pull requests and gates from. */
import { DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import type { RequiredContextGate } from "../../../../../live/github/requiredContexts.js";
import type { PrLiveState } from "../../../../../live/github/reviewState.js";
import { parseCodeowners } from "../../../../../review/codeowners.js";
import type { SlackCoverage } from "../../../../../review/slackEvidenceTypes.js";
import { soloPlace } from "../../../../../review/stack.js";

export const NOW = "2026-08-30T12:00:00.000Z";
export const CODEOWNERS = {
  path: ".github/CODEOWNERS",
  rules: parseCodeowners({ content: "* @org/eng\n/apps/etl @kel\n" }),
};

/** A CODEOWNERS naming only the pull request's author, so the author's own pull request is self-merging. */
export const SOLE_AUTHOR = {
  path: ".github/CODEOWNERS",
  rules: parseCodeowners({ content: "* @author-login\n" }),
};

/**
 * A live pull-request state, with the fields a test cares about overridden.
 *
 * @param over the fields this case changes from the neutral, green, mergeable default
 * @returns the composed state
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
  defaultBranch: "staging",
  headRefName: "feature/one",
  checks: {
    baseRef: undefined,
    checks: [{ kind: "check-run", name: "core", state: "passed", url: undefined }],
    headSha: "abc",
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
  createdAtIso: "2026-08-28T00:00:00Z",
  headOid: "abc",
  isDraft: false,
  mergeable: "MERGEABLE",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  number: 1,
  repoSlug: "o/r",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a title",
  updatedAtIso: "2026-08-28T01:00:00Z",
  url: "https://github.com/o/r/pull/1",
  ...over,
});

/** The place of a pull request that is alone on the default branch — every case that is not about stacks. */
export const SOLO = soloPlace({ pr: pr() });

export const COVERAGE: SlackCoverage = {
  corpusThroughIso: "2026-08-29T00:00:00Z",
  liveRan: true,
  neighbourhoods: [],
  shareThreads: {},
  residue: [],
};

/** A base branch that was read and requires nothing — the neutral gate these row assertions do not exercise. */
export const NO_REQUIRED_CONTEXTS: RequiredContextGate = {
  branch: "main",
  inFlight: [],
  kind: "read",
  mergeable: undefined,
  missing: [],
  required: [],
  unproven: [],
};
