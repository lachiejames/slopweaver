/**
 * The dispatch layer's shared test fixtures: one pull request's review state, the six landing tests passing, and
 * the inputs `dispatchDecision` and `draftVerdict` read — built here once so the dispatch tests and the draft tests
 * judge the SAME row rather than two copies that drift.
 */
import { codeownerTeamRequirement } from "../../../review/codeownerTeams.js";
import { githubCodeownerRequirement } from "../../../review/githubCodeowners.js";
import type { LandingTest } from "../../../review/landing.js";
import type { LandingBoardRow } from "../../../review/landingBoard.js";
import type { DispatchDecision, DispatchInputs } from "../../../review/landingDispatch.js";
import type { ConversationTallies } from "../../../review/reviewSignals.js";
import type { PrReviewState } from "../../../review/reviewState.js";

/** No board row joined to the head branch. */
export const NO_BOARD_ROW: LandingBoardRow = { kind: "none-declared", why: "no handover row declares this branch" };

/** One side of a conversation with nothing on it. */
export const NO_SIDE = { answeredOpen: 0, awaitingUs: 0, open: 0, reviewerLastWord: 0, resolved: 0 };

/** A conversation with nothing on either side. */
export const NO_TALK: ConversationTallies = { codeRabbit: NO_SIDE, humans: NO_SIDE };

/** All six tests passing, which is what a terminal verdict is allowed to rest on. */
export const PASSING: readonly LandingTest[] = [
  { id: "undrafted", verdict: "pass", why: "it is not a draft" },
  { id: "ci-green", verdict: "pass", why: "6/6 passed" },
  { id: "mergeable", verdict: "pass", why: "it merges cleanly into staging" },
  { id: "threads-clear", verdict: "pass", why: "no reviewer thread is waiting on us" },
  { id: "codeowners-satisfied", verdict: "pass", why: "GitHub holds no open code-owner request on it" },
  { id: "queue-available", verdict: "pass", why: "staging has a merge queue" },
];

/** No CODEOWNERS rule invoked by the changed paths. */
const NO_CODEOWNERS: PrReviewState["codeowners"] = {
  owed: [],
  rules: [],
  teams: codeownerTeamRequirement({ rules: [] }),
  verdict: "none",
  why: "the changed paths invoke no CODEOWNERS rule",
};

/** The base branch requires `build`, and it ran. */
const REQUIRED_BUILD: PrReviewState["requiredContexts"] = {
  branch: "staging",
  inFlight: [],
  kind: "read",
  mergeable: undefined,
  missing: [],
  required: ["build"],
  unproven: [],
};

/** A lone pull request straight onto the default branch. */
const UNSTACKED: PrReviewState["stack"] = {
  baseRefName: "staging",
  chain: [16378],
  defaultBranch: "staging",
  grounded: true,
  position: 1,
  size: 1,
  stacked: false,
};

/**
 * One pull request's review state, every field set, with the given fields overriding.
 *
 * @returns the review state
 */
export const state = (over: Partial<PrReviewState> = {}): PrReviewState => ({
  approvedBy: [],
  approverResidue: [],
  authorLogin: "the-owner",
  baseDistance: { kind: "read", value: { aheadBy: 2, behindBy: 47, status: "DIVERGED" } },
  baseRefName: "staging",
  createdAtIso: "2026-09-10T00:00:00Z",
  bump: { eligibleAtIso: "2026-09-11T00:00:00.000Z", kind: "too-soon", why: "asked recently" },
  checksRead: { kind: "read" },
  checksTruncated: false,
  ci: "green",
  ciDetail: "6/6 passed, 0 failed, 0 pending",
  codeRabbit: "green",
  codeRabbitDetail: "CodeRabbit approved the current head with nothing outstanding",
  codeowners: NO_CODEOWNERS,
  conflict: { local: { kind: "not-requested" }, mergeable: "MERGEABLE" },
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  reviewDecision: "",
  failingChecks: [],
  githubCodeowners: githubCodeownerRequirement({
    requests: [],
    requestsTruncated: false,
    reviews: [],
    reviewsTruncated: false,
  }),
  headOid: "1111111111111111111111111111111111111111",
  headRefName: "feature/one",
  labels: [],
  labelsTruncated: false,
  number: 16378,
  queueEntry: undefined,
  recommendation: "already-asked",
  repoSlug: "acme/widgets",
  requiredApprovers: [],
  requiredContexts: REQUIRED_BUILD,
  reviewedSinceAsk: [],
  channelShare: undefined,
  reviewsTruncated: false,
  slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
  stack: UNSTACKED,
  standingChangesRequested: [],
  threadBodiesRead: true,
  threads: [],
  threadsTruncated: false,
  title: "a change",
  undrafted: true,
  updatedAtIso: "2026-09-10T12:00:00.000Z",
  url: "https://github.com/acme/widgets/pull/16378",
  waitingOn: [],
  ...over,
});

/**
 * One decision as a single comparable string — `act:<verdict>` or the bare non-act kind.
 *
 * A projection rather than `toMatchObject`, which ignores every field it is not given and would pass over a
 * wrong `why`; and rather than narrowing the union in the test, which needs a conditional the testing rules
 * forbid inside an assertion. Each test asserts this exactly, and asserts `why` separately where the
 * sentence is the thing under test.
 *
 * @returns the comparable string
 */
export const summary = ({ decision }: { decision: DispatchDecision }): string =>
  decision.kind === "act" ? `act:${decision.verdict}` : decision.kind;

/** The brief a draft session carries on {@link state}'s head, spelled out so a softened "never close" fails. */
export const FINISH_OR_CARD =
  "read the linked Linear ticket's current state, look for a merged pull request that supersedes it, and read " +
  "the branch at 1111111; if the work is still wanted, finish it unasked: clear CodeRabbit, make the required " +
  "checks green, then undraft it; if the evidence says it is dead, record a shaped card proposing the close " +
  "with `handover ask --action` and never close it yourself — its age is never evidence either way";

/**
 * One row's dispatch inputs: a pressable pull request of the owner's with no board row, with the given fields overriding.
 *
 * @returns the inputs
 */
export const inputs = (over: Partial<DispatchInputs> = {}): DispatchInputs => ({
  action: "press",
  authoredByOwner: true,
  boardRow: NO_BOARD_ROW,
  conversations: NO_TALK,
  state: state(),
  tests: PASSING,
  ...over,
});
