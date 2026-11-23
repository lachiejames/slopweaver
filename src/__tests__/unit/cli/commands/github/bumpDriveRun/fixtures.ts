/*
 * The pure fixtures every `github bump-drive` test file shares: the acme organisation naming its own Renovate App,
 * the one head every bump sits at and the ledger ids filed under it, a green renovate bump, one held by a single
 * red check, an open bump of the owner's, and Renovate's merge that supersedes it.
 */
import type { AutonomyActionRow } from "../../../../../../autonomy/types.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../../live/github/baseDistance.js";
import type { PrLiveState } from "../../../../../../live/github/reviewState.js";
import type { Organisation } from "../../../../../../organisation/core.js";
import { dependencyBotActors } from "../../../../../../organisation/dependencyBots.js";
import type { MergedRenovatePr, OwnOpenPr } from "../../../../../../review/bumpSupersede.js";
import { ACME_ORGANISATION } from "../../../../../organisationFixture.js";

/** The acme organisation, naming its own self-hosted Renovate App, `acme-renovate`, as a dependency bot. */
export const ACME_WITH_RENOVATE: Organisation = { ...ACME_ORGANISATION, dependencyBots: ["acme-renovate"] };

/** The actors a pass resolves from {@link ACME_WITH_RENOVATE}, once, before it acts. */
export const ACME_BOTS = dependencyBotActors({ dependencyBots: ACME_WITH_RENOVATE.dependencyBots });

/** The head every bump in these cases sits at. */
export const HEAD = "1111111111111111111111111111111111111111";

/** The ids the bump's press, undraft and rewrite at {@link HEAD} are filed under — the press shared with landing. */
export const PRESS_ID = `enqueue-acme.widgets-661-${HEAD}`;
/** The id the bump's undraft at {@link HEAD} is filed under when the press after it refuses. */
export const UNDRAFT_ID = `undraft-acme.widgets-661-${HEAD}`;
/** The id the bump's description rewrite at {@link HEAD} is filed under. */
export const REWRITE_ID = `rewrite-acme.widgets-661-${HEAD}`;

const PASSING = { kind: "check-run", name: "build", state: "passed", url: undefined } as const;

/**
 * One act already on the ledger: the bump's description rewrite unless the case says otherwise.
 *
 * @returns that ledger row, with each field `over` names replaced
 */
export const heldAct = (over: Partial<AutonomyActionRow> = {}): AutonomyActionRow => ({
  actionId: REWRITE_ID,
  bySession: "an earlier pass",
  doneIso: "2026-09-19T02:00:00.000Z",
  kind: "rewrite-pull-request-body",
  subject: "https://github.com/acme/widgets/pull/661",
  why: "an earlier firing",
  witness: "slopweaver github bump-drive -> an earlier firing",
  ...over,
});

/**
 * One live renovate bump, green and unblocked unless the case says otherwise.
 *
 * @returns that pull request's live state, with each field `over` names replaced
 */
export const bump = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "acme-renovate[bot]",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "main",
  changedPaths: ["yarn.lock"],
  changedPathsTruncated: false,
  checks: {
    baseRef: "main",
    checks: [PASSING],
    headSha: HEAD,
    mergeable: undefined,
    residue: [],
    rollupState: "SUCCESS",
    supersededChecks: [],
    truncated: false,
  },
  checksRead: { kind: "read" },
  checksTruncated: false,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  createdAtIso: "2026-09-14T00:00:00Z",
  defaultBranch: "main",
  headOid: HEAD,
  headRefName: "renovate/typescript-6.x",
  headRepoSlug: "acme/widgets",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  number: 661,
  queueEntry: undefined,
  repoSlug: "acme/widgets",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "Update dependency typescript to v6",
  updatedAtIso: "2026-09-19T12:00:00Z",
  url: "https://github.com/acme/widgets/pull/661",
  ...over,
});

/**
 * One bump held by a single red check, `dev-gate` unless the case names another.
 *
 * A DRAFT, because that is the population `renovate.json`'s `draftPR: true` produces and the two failing
 * landing tests are then exactly `ci-green` and `undrafted` — the pair `bodyRewriteClears` accepts. Dependabot
 * by default, because a Renovate body is never rewritten (the owner's rule).
 *
 * @param redName the one check that fails beside the passing build
 * @returns that draft bump's live state
 */
export const devGateRed = ({
  authorLogin = "dependabot[bot]",
  redName = "dev-gate",
}: { authorLogin?: string; redName?: string } = {}): PrLiveState =>
  bump({
    authorLogin,
    checks: {
      baseRef: "main",
      checks: [PASSING, { kind: "check-run", name: redName, state: "failed", url: undefined }],
      headSha: HEAD,
      mergeable: undefined,
      residue: [],
      rollupState: "FAILURE",
      supersededChecks: [],
      truncated: false,
    },
    isDraft: true,
  });

/**
 * One open bump of the owner's on `main`, whose merge would still change the tree.
 *
 * @returns that open pull request, as the owner's own open-list read answers it
 */
export const ownBump = ({ number }: { number: number }): OwnOpenPr => ({
  baseRefName: "main",
  changedPaths: ["yarn.lock"],
  createdAtIso: "2026-10-05T23:00:00Z",
  headOid: HEAD,
  labels: [],
  number,
  repoSlug: "acme/widgets",
  testMerge: {
    baseTipOid: "2".repeat(40),
    baseTipTreeOid: "t".repeat(40),
    mergeTreeOid: "m".repeat(40),
    mergeable: "MERGEABLE",
    parentOids: ["2".repeat(40), HEAD],
  },
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119",
  url: `https://github.com/acme/widgets/pull/${String(number)}`,
});

/**
 * Renovate's merge of the same bump at a newer version, after the owner's opened.
 *
 * @returns that merged pull request, as the merged-search read answers it
 */
export const renovateMerge = (): MergedRenovatePr => ({
  baseRefName: "main",
  mergedAtIso: "2026-10-06T02:04:26Z",
  number: 16761,
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.124",
  url: "https://github.com/acme/widgets/pull/16761",
});
