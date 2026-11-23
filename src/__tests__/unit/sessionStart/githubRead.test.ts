import { describe, expect, it } from "vitest";
import { parseGithubReviewStateArgs } from "../../../cli/commands/github/reviewStateCore.js";
import type { ReviewStateRead } from "../../../cli/commands/github/reviewStateRun.js";
import { githubLegArgs, PR_LIMIT, readLimits, SEARCH_AUTHOR } from "../../../cli/commands/sessionStart/githubRead.js";
import { unwrap } from "../../../lib/result.js";
import { DISTANCE_NOT_REQUESTED } from "../../../live/github/baseDistance.js";
import { codeownerTeamRequirement } from "../../../review/codeownerTeams.js";
import { githubCodeownerRequirement } from "../../../review/githubCodeowners.js";
import { EMPTY_REVIEW_ROSTER } from "../../../review/reviewRoster.js";
import type { PrReviewState } from "../../../review/reviewState.js";
import type { SlackCoverage } from "../../../review/slackEvidenceTypes.js";

/*
 * `declaredRepoSlugs` and `readGithubPullRequests` are not exercised here. Both resolve a declared checkout
 * through `resolveRepository`, which shells out to `git remote get-url origin`, so covering them meant a real
 * `git init` plus `git remote add` per declared path inside a unit test. That made the file a load gauge
 * rather than an assertion: it went red on `Test timed out in 5000ms` at load average 15.79 with a different
 * case failing each run, while passing 16/16 alone, and it already carried a 30s describe budget. Deleting
 * those cases was chosen over injecting a seam to keep them.
 *
 * What that leaves uncovered anywhere is stated rather than implied: the refusal when `profile.json` declares
 * no `mainCheckouts`, one query across every declared repository, drafts not excluded, the `couldNotSee` line
 * for a checkout whose remote will not resolve, and same-repository collapse. Nothing in the subprocess or
 * integration lanes reaches that leg today. `resolveRepository` itself stays covered against real git by
 * `config.test.ts`'s own `resolveRepository (real git, scratch home)` suite, which is where the git door
 * belongs.
 */

const state = (over: Partial<PrReviewState> = {}): PrReviewState => ({
  approverResidue: [],
  authorLogin: "the-owner",
  baseRefName: "staging",
  createdAtIso: "2026-09-10T00:00:00Z",
  conflict: { local: { kind: "not-requested" }, mergeable: "MERGEABLE" },
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  reviewDecision: "",
  failingChecks: [],
  requiredContexts: { branch: "staging", kind: "read", mergeable: undefined, missing: [], required: [], unproven: [] },
  threadBodiesRead: false,
  threads: [],
  threadsTruncated: false,
  waitingOn: [],
  bump: { kind: "unknown", why: "not measured" },
  baseDistance: DISTANCE_NOT_REQUESTED,
  checksRead: { kind: "read" },
  checksTruncated: false,
  ci: "green",
  ciDetail: "6 of 6 green",
  codeRabbit: "green",
  codeRabbitDetail: "no comments",
  headOid: "0123456789abcdef0123456789abcdef01234567",
  headRefName: "feature/widget-7",
  labels: [],
  labelsTruncated: false,
  queueEntry: undefined,
  number: 7,
  recommendation: "send-ask",
  repoSlug: "acme/widgets",
  approvedBy: [],
  codeowners: {
    owed: [],
    rules: [],
    teams: codeownerTeamRequirement({ rules: [] }),
    verdict: "none",
    why: "the changed paths invoke no CODEOWNERS rule, so ownership requires no approval",
  },
  githubCodeowners: githubCodeownerRequirement({
    requests: [],
    requestsTruncated: false,
    reviews: [],
    reviewsTruncated: false,
  }),
  requiredApprovers: [],
  reviewedSinceAsk: [],
  channelShare: undefined,
  reviewsTruncated: false,
  standingChangesRequested: [],
  slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
  stack: {
    baseRefName: "staging",
    chain: [7],
    defaultBranch: "staging",
    grounded: true,
    position: 1,
    size: 1,
    stacked: false,
  },
  title: "a pull request title",
  undrafted: true,
  updatedAtIso: "2026-08-30T00:00:00.000Z",
  url: "https://github.com/acme/widgets/pull/7",
  ...over,
});

const coverage = (over: Partial<SlackCoverage> = {}): SlackCoverage => ({
  corpusThroughIso: "2026-08-31T00:00:00.000Z",
  liveRan: true,
  neighbourhoods: [],
  shareThreads: {},
  residue: ["a private channel is invisible to both Slack legs"],
  ...over,
});

const read = (over: Partial<ReviewStateRead> = {}): ReviewStateRead => ({
  coverage: coverage(),
  roster: EMPTY_REVIEW_ROSTER,
  states: [state()],
  total: 1,
  ...over,
});

describe("githubLegArgs", () => {
  it("searches for the owner's own pull requests without naming a login", () => {
    expect(githubLegArgs({ home: "/tmp/home", slugs: ["acme/widgets"] }).author).toBe(SEARCH_AUTHOR);
  });

  it("includes drafts, which the verb's own default excludes", () => {
    expect(githubLegArgs({ home: "/tmp/home", slugs: ["acme/widgets"] }).includeDrafts).toBe(true);
  });

  it("runs the live Slack leg, because whose move it is lives only in Slack", () => {
    expect(githubLegArgs({ home: "/tmp/home", slugs: ["acme/widgets"] }).slackLive).toBe(true);
  });

  // MEASURED: at a page of 50 this leg read ZERO pull requests — GitHub answered the fleet query
  // with no `search` connection at all — while the identical query answered 33 rows at the verb's own 20.
  // The page is the only lever over one request's nested node count, so it must not drift above the verb's.
  it("never asks for a bigger page than the verb the read goes through", () => {
    const args = githubLegArgs({ home: "/tmp/home", slugs: ["acme/widgets", "acme/gadgets"] });
    const verb = unwrap(parseGithubReviewStateArgs({ rest: ["--limit", String(PR_LIMIT)] }));
    expect(args.pageSize).toBe(verb.pageSize);
  });

  // A check page per caller is the defect one level up from one that parked a pull request:
  // the landing read was raised to 100 and this leg and the verb it goes through were left at 60, so the two
  // surfaces reported different check sets for the same head and only the landing one said it had truncated.
  // Both now read `CHECK_PAGE`, and 100 is GitHub's own per-connection ceiling — there is no larger page.
  it("asks for the same whole check page the verb and the landing read ask for", () => {
    const args = githubLegArgs({ home: "/tmp/home", slugs: ["acme/widgets"] });
    const verb = unwrap(parseGithubReviewStateArgs({ rest: [] }));
    expect(args.checkLimit).toBe(100);
    expect(verb.checkLimit).toBe(100);
  });

  it("passes every declared repository rather than the current checkout's one", () => {
    expect(githubLegArgs({ home: "/tmp/home", slugs: ["acme/widgets", "acme/gadgets"] }).repos).toEqual([
      "acme/widgets",
      "acme/gadgets",
    ]);
  });

  it("asks for a limit above the owner's measured open count", () => {
    expect(githubLegArgs({ home: "/tmp/home", slugs: [] }).limit).toBe(PR_LIMIT);
  });
});

describe("readLimits", () => {
  it("carries the Slack coverage residue through verbatim", () => {
    expect(readLimits({ read: read() })).toEqual(["a private channel is invisible to both Slack legs"]);
  });

  it("says so when the read was truncated, rather than printing a partial answer as a whole one", () => {
    expect(readLimits({ read: read({ total: 40 }) })).toEqual([
      "a private channel is invisible to both Slack legs",
      "only 1 of your 40 open pull requests were read — the rest are not on this list",
    ]);
  });
});
