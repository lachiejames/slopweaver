/**
 * `slopweaver github review-state` — assembling one answer per pull request, and rendering it.
 *
 * Pure. Everything effectful (the GraphQL pages, the corpus scan, the live Slack search, the roster read)
 * happens in `./reviewStateRun.ts` and arrives here as plain data, so the whole decision layer is unit
 * testable without a token, a clock or a network.
 *
 * The table is deliberately narrow — seven answers, one row, one line — because the point of the verb is to be
 * read across forty pull requests at once. Everything a row cannot carry lives in `--json`, which is the
 * progressive-disclosure arrangement rule 7 asks for rather than a second, longer table.
 */

import type { ConflictPathsRead } from "../../../checkouts/conflictPaths.js";
import { summarizeChecks } from "../../../live/github/checks.js";
import type { RequiredContextGate } from "../../../live/github/requiredContexts.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import type { BumpVerdict } from "../../../review/cadence.js";
import { isSoleAuthorRepository } from "../../../review/codeowners.js";
import { codeRabbitVerdict } from "../../../review/codeRabbitVerdict.js";
import {
  type FailingCheckDetail,
  failingChecks,
  type ThreadDetail,
  type ThreadTally,
  threadDetails,
  waitingOn,
} from "../../../review/prStateDetail.js";
import type { ReviewRoster } from "../../../review/reviewRoster.js";
import { standingChangesRequested } from "../../../review/reviewSignals.js";
import {
  type AskRecommendation,
  askBumpVerdict,
  askRecommendation,
  type ConflictState,
  ciVerdict,
  conflicting,
  type HumanReview,
  humanReviewsAfter,
  type PrReviewState,
  type SlackReviewState,
  slackReviewState,
} from "../../../review/reviewState.js";
import type { SlackCoverage, SlackMention } from "../../../review/slackEvidenceTypes.js";
import type { StackPlace } from "../../../review/stack.js";
import { conflictState } from "./reviewStateConflict.js";
import { ownershipAnswer, type RepoCodeowners } from "./reviewStateOwnership.js";
import { channelShareFor } from "./reviewStateShare.js";

export type { RepoCodeowners } from "./reviewStateOwnership.js";

/**
 * The humans who reviewed on GitHub after the newest ask, each with what they said.
 *
 * Empty when nobody has been asked at all: "reviewed since the ask" is meaningless without an ask, and a
 * bare list of every reviewer would read on a row as though a chase had already been answered.
 *
 * One entry per PERSON, keeping their newest review, because a reviewer who commented and then approved has
 * answered once — and a consumer that sees both reads the first as still-outstanding work.
 */
function reviewsSinceAsk({ asks, pr }: { asks: readonly SlackMention[]; pr: PrLiveState }): readonly HumanReview[] {
  const newest = asks[0];
  if (newest === undefined) {
    return [];
  }
  const byLogin = new Map<string, HumanReview>();
  for (const review of humanReviewsAfter({ askIso: newest.atIso, authorLogin: pr.authorLogin, reviews: pr.reviews })) {
    byLogin.set(review.login, review);
  }
  return [...byLogin.values()];
}

/**
 * The two verdicts a machine decides on its own — CI and CodeRabbit — plus the counts the row prints.
 *
 * Split out so the assembly below stays a single readable shape. Neither depends on Slack, the roster or
 * the clock, which is what makes them safe to compute in one step.
 *
 * @param pr the live pull-request state
 * @returns the checks summary, the CI verdict and the CodeRabbit verdict with its sentence
 */
function machineVerdicts({ pr }: { pr: PrLiveState }): {
  readonly summary: ReturnType<typeof summarizeChecks>;
  readonly ci: ReturnType<typeof ciVerdict>;
  readonly rabbit: ReturnType<typeof codeRabbitVerdict>;
} {
  const summary = summarizeChecks({ checks: pr.checks.checks });
  return {
    ci: ciVerdict({ checks: summary }),
    rabbit: codeRabbitVerdict({
      headOid: pr.headOid,
      reviews: pr.reviews,
      reviewsTruncated: pr.reviewsTruncated,
      threadCount: pr.threadCount,
      threads: pr.threads,
      threadsTruncated: pr.threadsTruncated,
    }),
    summary,
  };
}

/** The repository's CODEOWNERS rules — none when it declares no CODEOWNERS file at all. */
function declaredRules({ codeowners }: { codeowners: RepoCodeowners | undefined }): RepoCodeowners["rules"] {
  if (codeowners === undefined) {
    return [];
  }
  return codeowners.rules;
}

/**
 * The recommendation, with its three gates read off the live state: the conflict answer, the CODEOWNERS
 * sole-author test and where this pull request sits in its stack.
 *
 * @param pr the live pull-request state
 * @param codeowners that repository's rules, or undefined when it declares none
 * @param conflict question 8's answer
 * @param stack where this pull request sits among the fleet's chains
 * @param state the review answers that gate an ask
 * @returns the recommendation
 */
function recommend({
  pr,
  codeowners,
  conflict,
  stack,
  state,
}: {
  pr: PrLiveState;
  codeowners: RepoCodeowners | undefined;
  conflict: ConflictState;
  stack: StackPlace;
  state: Pick<PrReviewState, "undrafted" | "ci" | "slack" | "bump">;
}): AskRecommendation {
  return askRecommendation({
    conflicted: conflicting({ conflict }),
    selfMerging: isSoleAuthorRepository({
      authorLogin: pr.authorLogin,
      rules: declaredRules({ codeowners }),
    }),
    stacked: stack.stacked,
    state,
  });
}

/**
 * The bump verdict, with the four things it reads off the live state and the Slack answer.
 *
 * @param pr the live pull-request state
 * @param slack the Slack half of the answer, whose `why` being empty is what makes the read bounded
 * @param mentions every Slack message found for this pull request
 * @param roster the login → Slack id join
 * @param nowIso the reference instant
 * @returns the bump verdict
 */
function bumpFor({
  pr,
  slack,
  mentions,
  roster,
  nowIso,
}: {
  pr: PrLiveState;
  slack: SlackReviewState;
  mentions: readonly SlackMention[];
  roster: ReviewRoster;
  nowIso: string;
}): BumpVerdict {
  return askBumpVerdict({
    asks: slack.asks,
    authorLogin: pr.authorLogin,
    bounded: slack.bounded,
    mentions,
    nowIso,
    reviews: pr.reviews,
    slackIdForLogin: roster.slackIdForLogin,
  });
}

/**
 * The fields a row carries straight through from the live read, unchanged.
 *
 * Grouped rather than listed inline so {@link assembleReviewState} reads as the answers it DERIVES: every
 * name below is GitHub's own, and one of them silently changing meaning is a different class of bug from a
 * verdict being computed wrongly.
 *
 * @param pr the live pull-request state
 * @returns the passthrough half of a row
 */
function carriedThrough({
  pr,
}: {
  pr: PrLiveState;
}): Pick<
  PrReviewState,
  | "authorIsBot"
  | "authorLogin"
  | "baseDistance"
  | "baseRefName"
  | "changedPathsTruncated"
  | "checksRead"
  | "codeownersOffBase"
  | "checksTruncated"
  | "createdAtIso"
  | "githubMergeStatus"
  | "headOid"
  | "headRefName"
  | "labels"
  | "labelsTruncated"
  | "number"
  | "queueEntry"
  | "repoSlug"
  | "reviewDecision"
  | "reviewRequestTimes"
  | "reviewsTruncated"
  | "title"
  | "updatedAtIso"
  | "url"
> {
  return {
    ...(pr.authorIsBot === true ? { authorIsBot: true as const } : {}),
    authorLogin: pr.authorLogin,
    baseDistance: pr.baseDistance,
    baseRefName: pr.baseRefName,
    ...(pr.changedPathsTruncated ? { changedPathsTruncated: true as const } : {}),
    ...(pr.baseRefName === pr.defaultBranch ? {} : { codeownersOffBase: true as const }),
    checksRead: pr.checksRead,
    checksTruncated: pr.checksTruncated,
    createdAtIso: pr.createdAtIso,
    githubMergeStatus: pr.githubMergeStatus,
    headOid: pr.headOid,
    headRefName: pr.headRefName,
    labels: pr.labels,
    labelsTruncated: pr.labelsTruncated,
    number: pr.number,
    queueEntry: pr.queueEntry,
    repoSlug: pr.repoSlug,
    ...(pr.reviewRequestTimes === undefined ? {} : { reviewRequestTimes: pr.reviewRequestTimes }),
    reviewDecision: pr.reviewDecision,
    reviewsTruncated: pr.reviewsTruncated,
    title: pr.title,
    updatedAtIso: pr.updatedAtIso,
    url: pr.url,
  };
}

/**
 * The three granular answers, computed together because two of them read the same thread list.
 *
 * Split out of {@link assembleReviewState} to keep it under the function-length ratchet, and it is a real
 * seam rather than a cosmetic one: `waitingOn` is derived from the SAME `threadDetails` result the state
 * carries, so computing them apart would classify every thread twice and let the two drift.
 *
 * @param pr the live pull-request state
 * @param requiredContexts what the base branch's required-context read concluded
 * @returns the threads, who is waiting on them, and every non-passing check
 */
function granularState({ pr, requiredContexts }: { pr: PrLiveState; requiredContexts: RequiredContextGate }): {
  threads: readonly ThreadDetail[];
  waitingOn: readonly ThreadTally[];
  failingChecks: readonly FailingCheckDetail[];
} {
  const threads = threadDetails({ prAuthorLogin: pr.authorLogin, threads: pr.threads });
  return {
    failingChecks: failingChecks({ checks: pr.checks.checks, gate: requiredContexts }),
    threads,
    waitingOn: waitingOn({ details: threads, prAuthorLogin: pr.authorLogin }),
  };
}

/**
 * Assemble one pull request's complete answer from everything the shell fetched.
 *
 * @param pr the live pull-request state
 * @param codeowners that repository's rules, or undefined when it declares none
 * @param mentions every Slack message found for this pull request, newest first
 * @param coverage how far each Slack leg reached
 * @param roster the login → Slack id join, for attributing a review to the person who was tagged
 * @param nowIso the reference instant
 * @param conflictPaths what a local merge-tree named, or undefined when GitHub reports no conflict
 * @param stack where this pull request sits among the fleet's chains, from `../../../review/stack.ts`
 * @returns the seven answers plus the recommendation they imply
 */
export function assembleReviewState({
  pr,
  codeowners,
  mentions,
  coverage,
  roster,
  nowIso,
  conflictPaths,
  stack,
  requiredContexts,
  threadBodiesRead,
}: {
  pr: PrLiveState;
  codeowners: RepoCodeowners | undefined;
  mentions: readonly SlackMention[];
  coverage: SlackCoverage;
  roster: ReviewRoster;
  nowIso: string;
  conflictPaths: ConflictPathsRead | undefined;
  stack: StackPlace;
  requiredContexts: RequiredContextGate;
  threadBodiesRead: boolean;
}): PrReviewState {
  const { summary, ci, rabbit } = machineVerdicts({ pr });
  const slack = slackReviewState({ coverage, mentions, prUpdatedAtIso: pr.updatedAtIso });
  const bump = bumpFor({ mentions, nowIso, pr, roster, slack });
  const { approvers, approvedBy, owners, github, residue } = ownershipAnswer({ codeowners, pr });
  const undrafted = !pr.isDraft;
  const conflict = conflictState({ conflictPathsRead: conflictPaths, pr });
  const granular = granularState({ pr, requiredContexts });
  const channelShare = channelShareFor({ coverage, nowIso, pr, slack, threads: granular.threads });
  return {
    ...carriedThrough({ pr }),
    approvedBy: [...approvedBy],
    channelShare,
    approverResidue: residue,
    bump,
    ci,
    ciDetail: `${String(summary.passed)}/${String(summary.total)} passed, ${String(summary.failed)} failed, ${String(summary.running + summary.queued)} pending`,
    codeRabbit: rabbit.verdict,
    codeRabbitDetail: rabbit.detail,
    codeowners: owners,
    conflict,
    failingChecks: granular.failingChecks,
    githubCodeowners: github,
    recommendation: recommend({ codeowners, conflict, pr, stack, state: { bump, ci, slack, undrafted } }),
    requiredApprovers: approvers,
    requiredContexts,
    reviewedSinceAsk: reviewsSinceAsk({ asks: slack.asks, pr }),
    slack,
    stack,
    standingChangesRequested: standingChangesRequested({ authorLogin: pr.authorLogin, reviews: pr.reviews }),
    threadBodiesRead,
    threads: granular.threads,
    threadsTruncated: pr.threadsTruncated,
    undrafted,
    waitingOn: granular.waitingOn,
  };
}
