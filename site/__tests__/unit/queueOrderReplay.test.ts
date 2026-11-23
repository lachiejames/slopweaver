/*
 * The order the voice raises things in matches the order the queue puts them to the owner in, which matches the
 * alignment ranking.
 *
 * One plate, a recorded card set, read through every surface that orders it: the page's layout, the voice's
 * `action_items`, the triage order and the voice's triage walk. Each surface's real function, fed the same readings,
 * must put the same cards in the same order — and that order is the one the owner ruled: a card blocking a
 * priority first, then the owner's first priority's cards, then their second's, ranked by the controls each resolves,
 * then the held automation, then everything else. The board's reconcile is held to the same ruled head over the same fixture by
 * `src/__tests__/unit/handover/queueOrderReplay.test.ts`: importing `rank.ts` here would put the whole board graph
 * through the site's build type-check.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type Board, type HandStep, readBoard, readHandSteps } from "../../components/live/read";
import type { AutonomyRow } from "../../components/live/readAutonomy";
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
import type { LiveState } from "../../components/live/useLive";
import { triageWalkRows } from "../../components/voice/triageRun";
import type { CurrencyReading } from "../../lib/cardCurrency";
import { queueFocuses, queueOrdered, queueSectionOf } from "../../lib/queueFocus";
import { rowsOf } from "../../lib/queueRows";
import { queueScopeOf, queueShownCounts } from "../../lib/queueShownCounts";
import { withStopping } from "../../lib/queueStopping";
import { NO_STEERS } from "../../lib/steeredCards";
import { actionItemsAnswer } from "../../lib/talkActionItems";
import { triageOrder } from "../../lib/triage";
import { readWorkstreamTiles, type WorkstreamsView } from "../../lib/workstreamTiles";
import { ACME_PLACER } from "../organisationFixture";
import { NO_REVIEWERS } from "./actionItemReadingsFixture";
import { queueLayout } from "./inItsOwnView";

import { documentWith, linked, withDetail } from "./workstreamTilesFixture";

const AT = "2026-10-19T22:18:00.000Z";
const STEP = fileURLToPath(new URL("../../fixtures/hand-steps/recipe-stopped.json", import.meta.url));
const CALL_FIXTURE = fileURLToPath(
  new URL("../../../src/__tests__/fixtures/queue-order/call-d730d95c.json", import.meta.url),
);

/** The recorded card set and the owner's ruled head, shared with the reconcile replay. */
const CALL = JSON.parse(readFileSync(CALL_FIXTURE, "utf8")) as {
  readonly rows: readonly {
    readonly blockedBy: readonly string[];
    readonly slug: string;
    readonly tags: readonly (readonly [string, string])[];
  }[];
  readonly ruled: readonly string[];
};

/**
 * A reading, arrived.
 *
 * @returns the ready state
 */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return { fixture: undefined, observedAtIso: AT, phase: "ready", stampedByRoute: false, value };
}

/**
 * One ask waiting on the owner, as `handover list --json` publishes it, carrying the tags its row holds.
 *
 * @returns the published row
 */
function ask({
  slug,
  tags = [],
  blockedBy = [],
}: {
  slug: string;
  tags?: readonly (readonly [string, string])[];
  blockedBy?: readonly string[];
}): Record<string, unknown> {
  return {
    blockedBy,
    kind: "ask",
    ownerWait: "owner",
    priority: "p1",
    question: `Which way on ${slug}?`,
    questionAskedIso: "2026-10-19T08:00:00.000Z",
    reason: "waiting on the owner",
    repo: "/Users/someone/dev/personal/slopweaver",
    section: "WAITING ON OWNER",
    slug,
    status: "waiting-on-owner",
    tags: tags.map(([key, value]) => ({ key, source: "declared", value })),
    workspace: "team",
  };
}

/** The card set, in the order the registers hand it over — deliberately not the order the owner ruled. */
const BOARD_ROWS: readonly Record<string, unknown>[] = CALL.rows.map((row) => ask(row));

/** The owner's two priorities, the onboarding flow ranked first. */
const REGISTER = documentWith({
  workstreams: [
    withDetail({
      detail: {
        priority: { anchor: "talk-call:anchor#turn_A", because: "Tests to 95%", level: "urgent", rank: 2 },
        queueWorkstream: "iso-certification",
      },
      row: linked,
    }),
    {
      ...withDetail({
        detail: {
          priority: { anchor: "talk-call:anchor#turn_B", because: "the onboarding flow", level: "urgent", rank: 1 },
          queueWorkstream: "onboarding-flow",
        },
        row: linked,
      }),
      id: "nag",
      name: "Onboarding flow",
    },
  ],
});

const BOARD: Board = readBoard({ rows: BOARD_ROWS, unresolved: 0 })!;
const HANDS: readonly HandStep[] = readHandSteps([JSON.parse(readFileSync(STEP, "utf8")) as unknown])!;
const WORKSTREAMS = ready<WorkstreamsView>({ value: readWorkstreamTiles({ payload: REGISTER })! });
const FOCUSES = queueFocuses({ workstreams: WORKSTREAMS });

const LANDING: LandingReading = {
  by: "a tick",
  landing: {
    advisoryRedBypassed: undefined,
    byAction: [],
    census: undefined,
    people: new Map(),
    ready: 0,
    residue: [],
    rows: [],
    selection: undefined,
    total: 0,
  },
  observedAtIso: AT,
  readingId: "r1",
  recordedAtIso: AT,
};

/** A currency reading covering no card: it moves nothing, so every surface starts from the registers' own order. */
const NO_CURRENCY: Reading<CurrencyReading> = {
  by: "a tick",
  observedAtIso: AT,
  readingId: "c0",
  recordedAtIso: AT,
  value: {
    checkedIso: AT,
    readFromIso: "2026-10-18T22:18:00.000Z",
    rows: [],
    sources: { chair: "0 turns read", relays: "0 undelivered", voice: "0 unread call words" },
  },
};

/** The registers both the page and the voice read, every one arrived. */
const REGISTERS = {
  acts: ready<readonly AutonomyRow[]>({ value: [] }),
  board: ready<Board>({ value: BOARD }),
  drafts: ready<readonly HeldDraft[]>({ value: [] }),
  hands: ready<readonly HandStep[]>({ value: HANDS }),
  landing: ready<LandingReading>({ value: LANDING }),
  placer: ACME_PLACER,
  posts: ready<readonly ParkedDraft[]>({ value: [] }),
  reviewers: { phase: "loading" },
  reviews: ready<readonly ParkedReview[]>({ value: [] }),
  imports: ready<ImportQuestionReading>({ value: { questions: [] } }),
  standing: { phase: "loading" },
} as const;

/** The page's rows: every register projected, then stamped with what stops your work, as `useQueueRows` stamps them. */
const PAGE_ROWS = withStopping({ board: REGISTERS.board, focuses: FOCUSES, rows: rowsOf(REGISTERS) });

/** The page's Queue, top to bottom. */
const page = queueLayout({ expanded: [], focuses: FOCUSES, rows: PAGE_ROWS }).flatMap((entry) =>
  "key" in entry ? [entry.key] : [],
);

/** Everything the voice's `action_items` reads, as the console window holds it. */
const VOICE_READINGS: Parameters<typeof actionItemsAnswer>[0] = {
  ...REGISTERS,
  context: "everything",
  currency: ready<Reading<CurrencyReading>>({ value: NO_CURRENCY }),
  deferrals: ready<CardDeferrals>({ value: { deferrals: [], unreadable: 0 } }),
  nowIso: AT,
  // The voice reads reviewer suggestions too, and names them unread until they arrive.
  reviewers: ready<Reviewers>({ value: NO_REVIEWERS }),
  // And standing asks, which it names unread until they arrive; none is active here.
  standing: ready<StandingAskReading>({ value: { active: [], kind: "read" } }),
  shown: queueShownCounts({
    allDrawn: true,
    badgeRead: true,
    boardRead: true,
    context: "work",
    otherRows: [],
    rows: [],
    scope: queueScopeOf({ pathname: "/queue", search: "" }),
    splitRead: true,
  }),
  shows: () => true,
  spoken: ready<CardLandings>({
    value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
  }),
  steers: NO_STEERS,
  workstreams: WORKSTREAMS,
};

/** What the voice raises, first to last. */
const voice = actionItemsAnswer(VOICE_READINGS).items.map((item) => item.key);

/** The triage order a pass is taken in. */
const triage = triageOrder({
  rows: queueOrdered({ focuses: FOCUSES, rows: PAGE_ROWS }),
  sectionOf: (row) => queueSectionOf({ focuses: FOCUSES, row }),
}).map((row) => row.key);

/** The voice's triage walk. */
const walk = triageWalkRows({ focuses: FOCUSES, rows: PAGE_ROWS }).map((row) => row.key);

/** The held automation's card: the recipe-stopped monitor's own marked step. */
const HELD = HANDS[0].id;

describe("one ranking: the voice raises cards in the order the Queue shows them", () => {
  it("draws the owner's ruled order on the page", () => {
    expect(FOCUSES.map((focus) => focus.id)).toEqual(["nag", "iso"]);
    expect(page).toEqual([
      "ask:blocks-nag",
      "ask:blocks-vanta",
      "ask:nag-proposal",
      "ask:vanta-clears-8",
      "ask:vanta-clears-3",
      "ask:vanta-no-count",
      `hand:${HELD}`,
      "ask:colleague-reply",
      "ask:stale-p1",
    ]);
  });

  it("raises them by voice, and orders and walks a triage pass, in exactly the page's order", () => {
    expect(page.length).toBeGreaterThan(0);
    expect([voice, triage, walk]).toEqual([page, page, page]);
  });

  it("leads with the ruled head the board's reconcile replay is held to, a hand step being no board row", () => {
    const boardKeys = page.filter((key) => key.startsWith("ask:")).map((key) => key.slice("ask:".length));
    expect(boardKeys.slice(0, CALL.ruled.length)).toEqual(CALL.ruled);
    expect(FOCUSES.map((focus) => focus.queueWorkstream)).toEqual(["onboarding-flow", "iso-certification"]);
  });
});

describe("held to the cards the Queue on screen drew", () => {
  it("lists exactly the drawn cards, in the order the page drew them, whatever the ranking says", () => {
    const drawn = [page[3], page[0], page[6]];
    const answer = actionItemsAnswer({ ...VOICE_READINGS, drawn });
    expect(answer.items.map((item) => item.key)).toEqual(drawn);
    expect(answer.unread).toEqual([]);
  });

  it("lists nothing and names a drawn card its readings do not hold, never a list missing a card the owner sees", () => {
    const answer = actionItemsAnswer({ ...VOICE_READINGS, drawn: [page[0], "ask:acme-gone"] });
    expect(answer.items).toEqual([]);
    expect(answer.complete).toBe(false);
    expect(answer.unread).toEqual([
      {
        source: "the Queue on screen",
        why: "the Queue draws 1 card(s) this answer's readings do not hold (ask:acme-gone)",
      },
    ]);
  });

  it("lists nothing when the page drew nothing, though the registers hold cards", () => {
    expect(page).toHaveLength(9);
    expect(actionItemsAnswer({ ...VOICE_READINGS, drawn: [] }).items).toEqual([]);
  });
});
