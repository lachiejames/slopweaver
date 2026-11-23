/**
 * The landing tests' shared fixtures: one pull request whose six tests all pass, GitHub's codeowner answer built
 * from its own flags, one reviewer thread, and one landing row built over them — shared so every file under
 * `landing/` judges the SAME pull request rather than copies that drift.
 */
import { DISTANCE_NOT_REQUESTED } from "../../../../live/github/baseDistance.js";
import {
  type GithubCodeownerRequirement,
  type GithubReviewRequest,
  githubCodeownerRequirement,
} from "../../../../review/githubCodeowners.js";
import { githubMergeStatus } from "../../../../review/githubMergeStatus.js";
import { type LandingRow, landingRow, type QueueAvailability } from "../../../../review/landing.js";
import type { LandingBoardRow } from "../../../../review/landingBoard.js";
import type { ThreadDetail } from "../../../../review/prStateDetail.js";
import type { PrReviewState } from "../../../../review/reviewState.js";
import { state as dispatchState } from "../landingDispatchFixtures.js";

/** The head every fixture pull request sits at. */
export const HEAD = "0123456789abcdef0123456789abcdef01234567";

/** A base branch with a merge queue. */
export const HAS_QUEUE: QueueAvailability = { kind: "queue", url: "https://github.com/acme/widgets/queue/staging" };

/** No handover row declares the head branch. */
export const NO_ROW: LandingBoardRow = { kind: "none-declared", why: "no handover row declares this branch" };

/** GitHub reports the merge blocked — what it answers on a pull request a code owner really is holding. */
export const BLOCKED = githubMergeStatus({ value: "BLOCKED" });

/**
 * GitHub's codeowner answer built from the flags GitHub itself returns, never a hand-built literal.
 *
 * @returns the requirement GitHub's flags describe
 */
export const owners = ({
  requests = [],
  reviews = [],
  requestsTruncated = false,
  reviewsTruncated = false,
}: {
  requests?: readonly GithubReviewRequest[];
  reviews?: readonly { login: string; state: string; onBehalfOf: readonly string[] }[];
  requestsTruncated?: boolean;
  reviewsTruncated?: boolean;
} = {}): GithubCodeownerRequirement =>
  githubCodeownerRequirement({ requests, requestsTruncated, reviews, reviewsTruncated });

/**
 * One reviewer thread waiting on us, with the given fields overriding.
 *
 * @returns the thread
 */
export const thread = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({
  commentCount: 1,
  id: "PRRT_kwDOfake1",
  disposition: "awaiting-us",
  isOutdated: false,
  lastCommentAtIso: "2026-09-09T10:00:00.000Z",
  lastCommentLine: "please change this",
  lastCommentLogin: "a-reviewer",
  line: 12,
  openedAtIso: "2026-09-09T10:00:00.000Z",
  openedByLogin: "a-reviewer",
  openerLine: "please change this",
  path: "src/app.ts",
  ...over,
});

/**
 * A pull request whose six tests all pass, with the fields a test cares about overridden. It is the dispatch
 * fixture's pull request with the head, branch, clock and CodeRabbit fields this file's cases were written over.
 *
 * @returns the review state
 */
export const state = (over: Partial<PrReviewState> = {}): PrReviewState =>
  dispatchState({
    baseDistance: DISTANCE_NOT_REQUESTED,
    bump: { eligibleAtIso: "2026-09-10T00:00:00.000Z", kind: "too-soon", why: "asked recently" },
    codeRabbitDetail: "no comments",
    githubCodeowners: owners(),
    headOid: HEAD,
    headRefName: "feature/widget-7",
    updatedAtIso: "2026-09-09T12:00:00.000Z",
    ...over,
  });

/**
 * One landing row of the owner's over {@link state}, judged at a fixed instant, with the given inputs overriding.
 *
 * @param over the review-state fields to override
 * @param press the press this row's head was last pressed at, when there was one
 * @returns the landing row
 */
export const row = ({
  over = {},
  queueAvailability = HAS_QUEUE,
  press,
  optOutLabels = ["no-auto-merge"],
  boardRow = NO_ROW,
}: {
  over?: Partial<PrReviewState>;
  queueAvailability?: QueueAvailability;
  press?: { atIso: string; headOid: string };
  optOutLabels?: readonly string[];
  boardRow?: LandingBoardRow;
} = {}): LandingRow =>
  landingRow({
    inputs: {
      authoredByOwner: true,
      boardRow,
      nowIso: "2026-09-24T17:00:00.000Z",
      optOutLabels,
      ...(press === undefined ? { press: undefined } : { press }),
      queueAvailability,
      state: state(over),
    },
  });
