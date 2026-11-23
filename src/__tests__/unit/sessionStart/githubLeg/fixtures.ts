/*
 * The fakes the GitHub-leg test files share: the run's instant, the ids and roster an ask resolves through, and a
 * pull request's review state — ordinary, the sixth of a six-deep stack, and that stack's bottom. Pure data;
 * nothing here touches a disk or a provider.
 */
import { DISTANCE_NOT_REQUESTED } from "../../../../live/github/baseDistance.js";

import { codeownerTeamRequirement } from "../../../../review/codeownerTeams.js";
import { githubCodeownerRequirement } from "../../../../review/githubCodeowners.js";

import type { HumanReview, PrReviewState } from "../../../../review/reviewState.js";
import type { SlackMention } from "../../../../review/slackEvidenceTypes.js";

export const NOW = "2026-09-01T00:00:00.000Z";
export const OWNER = "owner-id";
export const BOT = "bot-id";
export const REVIEWER = "reviewer-id";
export const BOT_IDS = [BOT] as const;
export const NAMES = new Map([
  [REVIEWER, "A Colleague"],
  [OWNER, "The Owner"],
]);

/**
 * A Slack message the owner posted in a channel, linking acme/widgets#7 and tagging the reviewer.
 *
 * @returns the mention, with any field the caller overrides replaced
 */
export const mention = (over: Partial<SlackMention> = {}): SlackMention => ({
  atIso: "2026-08-30T00:00:00.000Z",
  authorId: OWNER,
  authoredPrCount: 1,
  authoredText: "",
  authorRole: "owner",
  firstLinkAt: -1,
  versionsDisagree: false,
  quotedPrKeys: [],
  conversation: "channel",
  linkSpans: [],
  mentions: [],
  messageKey: "C1:1",
  threadKey: "C1:1",
  association: "linked",
  threadPrKeys: [],
  channel: "channel-id",
  counterpartId: "",
  excerpt: "please take a look",
  isDirectMessage: false,
  leg: "corpus",
  permalink: "https://example.slack.com/archives/channel-id/p1",
  prKey: "acme/widgets#7",
  tagged: [REVIEWER],
  ...over,
});

/**
 * A human review that approved the pull request.
 *
 * @returns the review, with any field the caller overrides replaced
 */
export const review = (over: Partial<HumanReview> = {}): HumanReview => ({
  atIso: "2026-08-31T00:00:00.000Z",
  login: "a-colleague",
  opinion: "approved",
  ...over,
});

/** The first half of `state`'s fields, in its original key order. */
const stateHead = () =>
  ({
    approverResidue: [],
    authorLogin: "the-owner",
    baseRefName: "staging",
    createdAtIso: "2026-09-10T00:00:00Z",
    conflict: { local: { kind: "not-requested" }, mergeable: "MERGEABLE" },
    githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
    reviewDecision: "",
    failingChecks: [],
    requiredContexts: {
      branch: "staging",
      kind: "read",
      mergeable: undefined,
      missing: [],
      required: [],
      unproven: [],
    },
    threadBodiesRead: false,
    threads: [],
    threadsTruncated: false,
    waitingOn: [],
    bump: { kind: "too-soon", eligibleAtIso: "2026-09-02T00:00:00.000Z", why: "asked recently" },
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
    recommendation: "already-asked",
    repoSlug: "acme/widgets",
  }) satisfies Partial<PrReviewState>;

/** The second half of `state`'s fields, in its original key order. */
const stateTail = () =>
  ({
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
    stack: {
      baseRefName: "staging",
      chain: [7],
      defaultBranch: "staging",
      grounded: true,
      position: 1,
      size: 1,
      stacked: false,
    },
    standingChangesRequested: [],
    slack: { asked: "yes", asks: [mention()], bounded: true, mentioned: "yes", mentions: [mention()], why: "" },
    title: "a pull request title",
    undrafted: true,
    updatedAtIso: "2026-08-30T00:00:00.000Z",
    url: "https://github.com/acme/widgets/pull/7",
  }) satisfies Partial<PrReviewState>;

/**
 * An undrafted acme/widgets#7, green, alone on the default branch, already asked of the reviewer in Slack.
 *
 * @returns the review state, with any field the caller overrides replaced
 */
export const state = (over: Partial<PrReviewState> = {}): PrReviewState => ({
  ...stateHead(),
  ...stateTail(),
  ...over,
});

/**
 * The sixth pull request of a six-deep stack — the shape a stack ruling covers.
 *
 * @returns the stacked draft's review state, with any field the caller overrides replaced
 */
export const sixthOfSix = (over: Partial<PrReviewState> = {}): PrReviewState =>
  state({
    number: 16355,
    recommendation: "stacked",
    slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
    stack: {
      baseRefName: "stack/5",
      chain: [16415, 16341, 16378, 16338, 16339, 16355],
      defaultBranch: "staging",
      grounded: true,
      position: 6,
      size: 6,
      stacked: true,
    },
    undrafted: false,
    url: "https://github.com/acme/widgets/pull/16355",
    ...over,
  });

/**
 * The bottom of that same stack — the one row that carries the ask.
 *
 * @returns the bottom row's review state, with any field the caller overrides replaced
 */
export const bottomOfSix = (over: Partial<PrReviewState> = {}): PrReviewState =>
  state({
    number: 16415,
    recommendation: "send-ask",
    slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
    stack: {
      baseRefName: "staging",
      chain: [16415, 16341, 16378, 16338, 16339, 16355],
      defaultBranch: "staging",
      grounded: true,
      position: 1,
      size: 6,
      stacked: false,
    },
    url: "https://github.com/acme/widgets/pull/16415",
    ...over,
  });
