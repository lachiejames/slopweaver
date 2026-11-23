/*
 * The readings the voice's Queue answer takes, all arrived, and the plate the owner meets over them — shared by
 * `./talkActionItems.test.ts` and `./talkActionItemsWithheld.test.ts`, split by describe block.
 */
import { type Board, type HandStep, readBoard, readHandSteps } from "../../components/live/read";
import { type AutonomyRow, readAutonomy } from "../../components/live/readAutonomy";
import type { CardDeferrals } from "../../components/live/readCardDeferrals";
import type { CardLandings } from "../../components/live/readCardLandings";
import type { ImportQuestionReading } from "../../components/live/readImportQuestions";
import type { Reading } from "../../components/live/reading";
import type { LandingReading } from "../../components/live/readLanding";
import type { ParkedReview } from "../../components/live/readReviewDrafts";
import type { Reviewers } from "../../components/live/readReviewers";
import type { ParkedDraft } from "../../components/live/readSlackDrafts";
import type { StandingAskReading } from "../../components/live/readStandingAsks";
import type { HeldDraft } from "../../components/live/readThread";
import type { CurrencyReading } from "../../lib/cardCurrency";
import { queueScopeOf, queueShownCounts } from "../../lib/queueShownCounts";
import { NO_STEERS } from "../../lib/steeredCards";
import type { actionItemsAnswer } from "../../lib/talkActionItems";
import { readWorkstreamTiles, type WorkstreamsView } from "../../lib/workstreamTiles";
import { ACME_PLACER } from "../organisationFixture";

import { BOARD, LANDING, NO_CURRENCY, NO_REVIEWERS, ready } from "./actionItemReadingsFixture";
import { documentWith } from "./workstreamTilesFixture";

/** The caller's clock, an hour after the owner's plate was read. */
export const NOW = "2026-09-24T18:00:00.000Z";

/** The app's counts over an empty Queue, every one printed. */
export const SHOWN_EMPTY = queueShownCounts({
  allDrawn: true,
  badgeRead: true,
  boardRead: true,
  context: "work",
  otherRows: [],
  rows: [],
  scope: queueScopeOf({ pathname: "/queue", search: "" }),
  splitRead: true,
});

/**
 * Everything the tab reads, all arrived, each at its own instant so the oldest is identifiable.
 *
 * @returns the readings, all arrived and all empty
 */
export function allReady(): Parameters<typeof actionItemsAnswer>[0] {
  return {
    acts: ready<readonly AutonomyRow[]>({ at: "2026-09-23T06:00:00.000Z", value: [] }),
    board: ready<Board>({ at: "2026-09-23T02:00:00.000Z", value: BOARD }),
    context: "everything",
    currency: ready<Reading<CurrencyReading>>({ at: "2026-09-23T08:00:00.000Z", value: NO_CURRENCY }),
    deferrals: ready<CardDeferrals>({ at: "2026-09-23T07:30:00.000Z", value: { deferrals: [], unreadable: 0 } }),
    drafts: ready<readonly HeldDraft[]>({ at: "2026-09-23T03:00:00.000Z", value: [] }),
    hands: ready<readonly HandStep[]>({ at: "2026-09-23T01:00:00.000Z", value: [] }),
    landing: ready<LandingReading>({ at: "2026-09-23T05:00:00.000Z", value: LANDING }),
    nowIso: NOW,
    placer: ACME_PLACER,
    posts: ready<readonly ParkedDraft[]>({ at: "2026-09-23T04:00:00.000Z", value: [] }),
    reviewers: ready<Reviewers>({ at: "2026-09-23T05:30:00.000Z", value: NO_REVIEWERS }),
    standing: ready<StandingAskReading>({ at: "2026-09-23T05:45:00.000Z", value: { active: [], kind: "read" } }),
    reviews: ready<readonly ParkedReview[]>({ at: "2026-09-23T04:30:00.000Z", value: [] }),
    imports: ready<ImportQuestionReading>({ at: "2026-09-23T04:45:00.000Z", value: { questions: [] } }),
    shown: SHOWN_EMPTY,
    shows: () => true,
    spoken: ready<CardLandings>({
      at: "2026-09-23T07:00:00.000Z",
      value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
    }),
    steers: NO_STEERS,
    workstreams: ready<WorkstreamsView>({
      at: "2026-09-23T09:00:00.000Z",
      value: readWorkstreamTiles({ payload: documentWith({ workstreams: [] }) })!,
    }),
  };
}

/**
 * One ask on the board waiting on the owner's word, stating its `workspace`.
 *
 * @returns the board row, unread
 */
export function ownerAsk({ slug, workspace }: { slug: string; workspace: string }): Record<string, unknown> {
  return {
    kind: "ask",
    ownerWait: "owner",
    question: `Which way on ${slug}?`,
    questionAskedIso: "2026-09-22T11:00:00.000Z",
    reason: "waiting on the owner",
    section: "runnable",
    slug,
    status: "waiting-on-owner",
    workspace,
  };
}

/**
 * The plate the owner meets, in the order the registers hand it over: a dogfood check-in step and a
 * fleet ask ahead of a work ask, and the ledger's acts after them.
 *
 * @returns the readings, all arrived
 */
export function ownerPlate(): Parameters<typeof actionItemsAnswer>[0] {
  const at = "2026-09-24T17:00:00.000Z";
  const steps = readHandSteps([
    {
      checkIn: true,
      id: "try-now-page",
      postedIso: "2026-09-24T16:00:00.000Z",
      unblocks: "handover now-page-design-options-before-any-build",
      what: "Open the new Now page and say whether it answers what each agent is doing",
      witness: "slopweaver hand done try-now-page",
    },
  ]);
  const board = readBoard({
    rows: [
      ownerAsk({ slug: "chair-respawn", workspace: "self" }),
      // A colleague waits on it through the pull request they are on — a stated workspace alone names nobody.
      {
        ...ownerAsk({ slug: "iso-evidence-door", workspace: "team" }),
        prUrls: ["https://github.com/acme/acme-admin/pull/17648"],
      },
    ],
    unresolved: 0,
  });
  const acts = readAutonomy([
    {
      action: {
        actionId: "edit-pr-17648",
        doneIso: "2026-09-24T10:00:00.000Z",
        kind: "edit-pr-description",
        subject: "acme/acme-admin#17648",
        why: "stale description",
      },
    },
  ]);
  if (steps === undefined || board === undefined || acts === undefined) {
    throw new Error("a fixture reading did not read");
  }
  return {
    ...allReady(),
    acts: ready<readonly AutonomyRow[]>({ at, value: acts }),
    board: ready<Board>({ at, value: board }),
    hands: ready<readonly HandStep[]>({ at, value: steps }),
  };
}
