import { describe, expect, it } from "vitest";

import { type Board, type HandStep, readBoard, readHandSteps } from "../../components/live/read";
import type { CardDeferrals } from "../../components/live/readCardDeferrals";
import { type CardLandings, readCardLandings } from "../../components/live/readCardLandings";
import { type ImportQuestionReading, readImportQuestions } from "../../components/live/readImportQuestions";
import type { Reading } from "../../components/live/reading";
import type { ParkedReview } from "../../components/live/readReviewDrafts";
import type { LiveState } from "../../components/live/useLive";
import { runReadCard } from "../../components/voice/openCardRun";
import { CURRENCY_CHECK, type CurrencyReading } from "../../lib/cardCurrency";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import { queueScopeOf, queueShownCounts } from "../../lib/queueShownCounts";
import type { ViewCard } from "../../lib/queueViews";
import { NO_STEERS, type SteerOverlay } from "../../lib/steeredCards";
import { actionItemProjection, actionItemsAnswer } from "../../lib/talkActionItems";
import { readWorkstreamTiles, type WorkstreamsView } from "../../lib/workstreamTiles";
import { ACME_PLACER } from "../organisationFixture";

import { BOARD, ready } from "./actionItemReadingsFixture";
import { allReady, NOW, ownerAsk, ownerPlate, SHOWN_EMPTY } from "./ownerPlateFixture";
import { documentWith, linked, withDetail } from "./workstreamTilesFixture";

/**
 * Each reading the answer's items come from, beside the words the answer must use for it. The autonomy ledger is
 * passed too but never named: its acts are the Alignment page's, never an action item, so its absence leaves no
 * item unsaid. The workstreams register IS named: unread, it lifts nothing, so the order said is tier order and may
 * not be the one its priorities would give.
 */
const SOURCES = [
  { key: "hands", source: "your hands" },
  { key: "board", source: "the board" },
  { key: "drafts", source: "held replies" },
  { key: "posts", source: "drafts under your own name" },
  { key: "reviews", source: "reviews under your name" },
  { key: "imports", source: "import questions" },
  { key: "landing", source: "pull requests" },
  { key: "reviewers", source: "reviewer suggestions" },
  { key: "deferrals", source: "card deferrals" },
  { key: "standing", source: "standing asks" },
  { key: "currency", source: CURRENCY_CHECK },
  { key: "workstreams", source: "your workstream priorities" },
  { key: "spoken", source: "your spoken steers" },
] as const;

/**
 * The owner's plate in their ISO week: an urgent workstream naming `iso-certification`, one team card carrying that tag, a
 * team ask a colleague waits on, and a held review of a colleague's pull request.
 *
 * @returns the readings, all arrived
 */
function isoFocusPlate(): Parameters<typeof actionItemsAnswer>[0] {
  const at = "2026-09-24T17:00:00.000Z";
  const board = readBoard({
    rows: [
      {
        ...ownerAsk({ slug: "iso-evidence-door", workspace: "team" }),
        prUrls: ["https://github.com/acme/acme-admin/pull/17648"],
      },
      {
        ...ownerAsk({ slug: "iso-policy", workspace: "team" }),
        tags: [{ key: "workstream", source: "declared", value: "iso-certification" }],
      },
    ],
    unresolved: 0,
  })!;
  const review: ParkedReview = {
    author: "a-colleague",
    body: "Looks right.",
    comments: [],
    deeperReview: undefined,
    digest: "d1",
    headSha: "abc123",
    id: "rv1",
    number: 17650,
    outcome: undefined,
    postCommand: "slopweaver github review-draft post rv1",
    repo: "acme/acme-admin",
    resolvedIso: undefined,
    state: "held",
    title: "A colleague's change",
    tsIso: "2026-09-01T16:00:00.000Z",
    url: "https://github.com/acme/acme-admin/pull/17650",
    verdict: "APPROVE",
    why: "a colleague asked",
  };
  const focus = withDetail({
    detail: {
      priority: { anchor: "talk-call:a0000024#turn_EXx", because: "the ISO week", level: "urgent" },
      queueWorkstream: "iso-certification",
    },
    row: linked,
  });
  return {
    ...ownerPlate(),
    board: ready<Board>({ at, value: board }),
    reviews: ready<readonly ParkedReview[]>({ at, value: [review] }),
    workstreams: ready<WorkstreamsView>({
      at,
      value: readWorkstreamTiles({ payload: documentWith({ workstreams: [focus] }) })!,
    }),
  };
}

describe("actionItemsAnswer — ranked, and led by the top blocker", () => {
  it("leads with the work ask, then the fleet's, ends on the check-in, and never offers an act", () => {
    const answer = actionItemsAnswer(ownerPlate());
    expect(answer.items.map((item) => item.key)).toEqual([
      "ask:iso-evidence-door",
      "ask:chair-respawn",
      "hand:try-now-page",
    ]);
    expect(answer.items.map((item) => item.tier)).toEqual(["team-blocked", "fleet-blocked", "check-in"]);
  });

  it("does not wait on the autonomy ledger, whose acts are never items", () => {
    const answer = actionItemsAnswer({ ...ownerPlate(), acts: { phase: "loading" } });
    expect(answer.unread).toEqual([]);
    expect(answer.complete).toBe(true);
  });

  // Every Alignment act must be read, so the card tools see one.
  it("projects the acts the Alignment page asks about beside the items, never among them", () => {
    const { alignment, live } = actionItemProjection({ nowIso: NOW, placer: ACME_PLACER, readings: ownerPlate() });
    expect(alignment.map((row) => row.key)).toEqual(["act:edit-pr-17648"]);
    expect(live.map((row) => row.key)).toEqual(["ask:iso-evidence-door", "ask:chair-respawn", "hand:try-now-page"]);
  });

  it("names the work ask as the one to open with", () => {
    expect(actionItemsAnswer(ownerPlate()).top!.key).toBe("ask:iso-evidence-door");
  });

  it("lifts a card of the owner's focus workstream ahead of a colleague's, as the page draws it", () => {
    const plate = ownerPlate();
    const board = readBoard({
      rows: [
        {
          ...ownerAsk({ slug: "iso-policy", workspace: "team" }),
          tags: [{ key: "workstream", source: "declared", value: "iso-certification" }],
        },
        {
          ...ownerAsk({ slug: "iso-evidence-door", workspace: "team" }),
          prUrls: ["https://github.com/acme/acme-admin/pull/17648"],
        },
      ],
      unresolved: 0,
    })!;
    const focus = withDetail({
      detail: {
        priority: { anchor: "talk-call:a0000024#turn_EXx", because: "the ISO week", level: "urgent" },
        queueWorkstream: "iso-certification",
      },
      row: linked,
    });
    const answer = actionItemsAnswer({
      ...plate,
      board: ready<Board>({ at: "2026-09-24T17:00:00.000Z", value: board }),
      workstreams: ready<WorkstreamsView>({
        at: "2026-09-24T17:00:00.000Z",
        value: readWorkstreamTiles({ payload: documentWith({ workstreams: [focus] }) })!,
      }),
    });
    expect(answer.items.map((item) => [item.key, item.tier])).toEqual([
      ["ask:iso-policy", "fleet-blocked"],
      ["ask:iso-evidence-door", "team-blocked"],
      ["hand:try-now-page", "check-in"],
    ]);
    expect(answer.top!.key).toBe("ask:iso-policy");
  });

  // The projection both lists share is never ordered — only the list the owner is offered. A colleague's PR
  // review is not lifted: everything but the owner's priorities sits below them.
  it("orders the list the owner is offered, never the projection every list is cut from, with no PR-review lift", () => {
    const plate = isoFocusPlate();
    const { live } = actionItemProjection({ nowIso: NOW, placer: ACME_PLACER, readings: plate });

    expect(live.map((row) => row.key)).toEqual([
      "ask:iso-evidence-door",
      "review:rv1",
      "ask:iso-policy",
      "hand:try-now-page",
    ]);
    expect(actionItemsAnswer(plate).items.map((item) => item.key)).toEqual([
      "ask:iso-policy",
      "ask:iso-evidence-door",
      "review:rv1",
      "hand:try-now-page",
    ]);
  });

  // The voice stamps the owner's deferrals as the page does, so a focus card they put off lifts no review.
  it("lifts nothing over a focus card the owner put off, and names it last as the page draws it", () => {
    const plate = isoFocusPlate();
    const putOff = ready<CardDeferrals>({
      at: "2026-09-24T17:00:00.000Z",
      value: { deferrals: [{ cardKey: "ask:iso-policy", deferredIso: "2026-09-24T16:00:00.000Z" }], unreadable: 0 },
    });
    const answer = actionItemsAnswer({ ...plate, deferrals: putOff });

    expect(answer.items.map((item) => item.key)).toEqual([
      "ask:iso-evidence-door",
      "review:rv1",
      "hand:try-now-page",
      "ask:iso-policy",
    ]);
  });

  // The order without its priorities is tier order, which may not be the one they would give, so the
  // register is named unread; the items still stand where the page draws them without it.
  it("names the register unread when it could not be read, every item then by its tier as on the page", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      workstreams: { phase: "not-measured", why: "the verb exited 1" },
    });
    expect(answer.unread).toEqual([{ source: "your workstream priorities", why: "the verb exited 1" }]);
    expect(answer.complete).toBe(false);
    expect(answer.items.map((item) => item.key)).toEqual([
      "ask:iso-evidence-door",
      "ask:chair-respawn",
      "hand:try-now-page",
    ]);
  });

  it("ranks by the currency reading the Queue ranks by: an ask the owner looks to have answered drops to the check-ins", () => {
    const asked = "2026-09-22T11:00:00.000Z";
    const currency: CurrencyReading = {
      checkedIso: "2026-09-24T17:30:00.000Z",
      readFromIso: "2026-09-22T00:00:00.000Z",
      rows: [
        {
          askedIso: asked,
          done: { atIso: "2026-09-24T12:00:00.000Z", kind: "replied", permalink: "https://acme.slack.com/p1" },
          floorIso: asked,
          key: "ask:iso-evidence-door",
          since: { gaps: [], standing: [], words: [] },
        },
      ],
      sources: { chair: "1 turn read", relays: "0 undelivered", voice: "0 unread call words" },
    };
    const reading: Reading<CurrencyReading> = {
      by: "a tick",
      observedAtIso: "2026-09-24T17:30:00.000Z",
      readingId: "c1",
      recordedAtIso: "2026-09-24T17:30:00.000Z",
      value: currency,
    };
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      currency: ready<Reading<CurrencyReading>>({ at: "2026-09-24T17:30:00.000Z", value: reading }),
    });

    expect(answer.items.map((item) => [item.key, item.tier])).toEqual([
      ["ask:chair-respawn", "fleet-blocked"],
      ["hand:try-now-page", "check-in"],
      ["ask:iso-evidence-door", "check-in"],
    ]);
    expect(answer.top!.key).toBe("ask:chair-respawn");
  });

  it("carries no tally of its own capped rows beside `shown`, so the voice has one source of Queue figures", () => {
    expect(Object.keys(actionItemsAnswer(ownerPlate())).toSorted()).toEqual([
      "beyondCap",
      "complete",
      "context",
      "cut",
      "itemNames",
      "items",
      "observedAtIso",
      "recentlyLeft",
      "recentlyLeftBeyondCap",
      "recentlyLeftNames",
      "shown",
      "top",
      "unread",
      "withheld",
    ]);
  });

  it("hands over the app's counts under the labels it prints, and unread where it prints none", () => {
    const incident: ViewCard[] = [
      ...Array.from({ length: 26 }, (): ViewCard => ({
        kind: "ask",
        tags: [],
        tagsRead: "whole",
        tier: "fleet-blocked",
      })),
      ...Array.from({ length: 3 }, (): ViewCard => ({ kind: "hand", tags: [], tagsRead: "whole", tier: "check-in" })),
    ];
    const scope = queueScopeOf({ pathname: "/queue", search: "" });
    const counts = { badgeRead: true, boardRead: true, otherRows: [], rows: incident, scope, splitRead: true };
    const shown = queueShownCounts({ ...counts, allDrawn: true, context: "slopweaver" });
    expect(actionItemsAnswer({ ...ownerPlate(), shown }).shown).toEqual({
      "Blocking a colleague": 0,
      "Blocking the fleet": 26,
      "Check-ins": 3,
      Everything: 29,
      "In the work context": 0,
      "New findings": 0,
      Queue: 26,
      "Reviews under your name": 0,
      "Slack drafts": 0,
      Urgent: 0,
    });
    const before = queueShownCounts({ ...counts, allDrawn: false, badgeRead: false, context: "slopweaver" });
    expect(actionItemsAnswer({ ...ownerPlate(), shown: before }).shown["Everything"]).toBe("unread");
    expect(actionItemsAnswer({ ...ownerPlate(), shown: before }).shown["In the work context"]).toBe("unread");
  });

  it("names the other context's cards under a label naming that context, so an empty view is never said as a quiet Queue", () => {
    // The incident: the work context's Queue read Everything 0 while the Slopweaver context held twenty cards.
    const twenty = Array.from({ length: 20 }, () => ({ kind: "ask" }));
    const shown = queueShownCounts({
      allDrawn: true,
      badgeRead: true,
      boardRead: true,
      context: "work",
      otherRows: twenty,
      rows: [],
      scope: queueScopeOf({ pathname: "/queue", search: "" }),
      splitRead: true,
    });
    const answer = actionItemsAnswer({ ...ownerPlate(), context: "work", shown });
    expect([answer.context, answer.shown["Everything"], answer.shown["In the Slopweaver context"]]).toEqual([
      "work",
      0,
      20,
    ]);
  });

  it("says a check-in is one, in words the voice can speak", () => {
    const step = actionItemsAnswer(ownerPlate()).items.find((item) => item.key === "hand:try-now-page")!;
    expect(step.tierWords).toBe(
      "a check-in: a review of something already built, or an ask that looks answered already",
    );
  });

  it("never leads with a check-in when check-ins are all there is", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      board: ready<Board>({ at: "2026-09-24T17:00:00.000Z", value: BOARD }),
    });
    expect(answer.items.map((item) => item.tier)).toEqual(["check-in"]);
    expect(answer.top).toBe(undefined);
  });
});

describe("actionItemsAnswer", () => {
  it("names every source its items come from, so a fourteenth one added to the projection cannot go unnamed", () => {
    expect(SOURCES.length).toBe(13);
    const all = allReady();
    expect(SOURCES.filter((row) => !(row.key in all))).toEqual([]);
  });

  it("is complete only when all thirteen arrived, and states no total it could not measure", () => {
    const answer = actionItemsAnswer(allReady());
    expect(answer.complete).toBe(true);
    expect(answer.unread).toEqual([]);
    expect(answer.items).toEqual([]);
    expect(answer.context).toBe("everything");
  });

  it("reports the OLDEST arrival, so one fast register cannot vouch for five slow ones", () => {
    expect(actionItemsAnswer(allReady()).observedAtIso).toBe("2026-09-23T01:00:00.000Z");
  });

  it.each(SOURCES)("names $source when only that reading is missing", ({ key, source }) => {
    // Five readings really arrive here, so an answer that forgot this one would report `unread: []` and
    // `complete: true` — which is exactly the silent zero this assertion is falsifiable against.
    const answer = actionItemsAnswer({ ...allReady(), [key]: { phase: "not-measured", why: "the verb exited 1" } });
    expect(answer.unread).toEqual([{ source, why: "the verb exited 1" }]);
    expect(answer.complete).toBe(false);
  });

  it.each(SOURCES)("says $source is still loading rather than calling it measured", ({ key, source }) => {
    const answer = actionItemsAnswer({ ...allReady(), [key]: { phase: "loading" } });
    expect(answer.unread).toEqual([{ source, why: "still loading" }]);
    expect(answer.complete).toBe(false);
  });

  it("lists and counts no hand step while the board its placement joins is loading", () => {
    const steps = readHandSteps([
      {
        id: "h1",
        postedBy: "workspace:1",
        postedIso: "2026-09-23T00:00:00.000Z",
        url: "http://localhost:3000/queue?open=ask%3Aacme-row",
        what: "Answer the acme row",
      },
    ])!;
    const hands = ready<readonly HandStep[]>({ at: "2026-09-23T01:00:00.000Z", value: steps });
    const waiting = actionItemsAnswer({ ...allReady(), board: { phase: "loading" }, hands });
    expect(waiting.items).toEqual([]);
    expect(waiting.beyondCap).toEqual({ marked: false, more: false, parked: false });
    expect(actionItemsAnswer({ ...allReady(), hands }).items.map((item) => item.key)).toEqual(["hand:h1"]);
  });

  it("says rows exist below the cap, and findings among them, never how many", () => {
    const placed = Array.from({ length: 25 }, (_, n) =>
      ownerAsk({ slug: `acme-${String(n).padStart(2, "0")}`, workspace: "team" }),
    );
    const unplaced = { ...ownerAsk({ slug: "zz-unplaced", workspace: "team" }), workspace: undefined };
    const board = readBoard({ rows: [...placed, unplaced], unresolved: 0 })!;
    const answer = actionItemsAnswer({
      ...allReady(),
      board: ready<Board>({ at: "2026-09-23T02:00:00.000Z", value: board }),
    });
    expect(answer.items.length).toBe(25);
    expect(answer.items.map((item) => item.key)).not.toContain("ask:zz-unplaced");
    expect(answer.beyondCap).toEqual({ marked: true, more: true, parked: false });
    expect(
      actionItemsAnswer({
        ...allReady(),
        board: ready<Board>({ at: "2026-09-23T02:00:00.000Z", value: readBoard({ rows: placed, unresolved: 0 })! }),
      }).beyondCap,
    ).toEqual({ marked: false, more: false, parked: false });
  });

  // A parked card is listed last, so a full list cuts it first; the answer says one is there.
  it("says a card the owner parked is among the rows below the cap, never how many", () => {
    const placed = Array.from({ length: 26 }, (_, n) =>
      ownerAsk({ slug: `acme-${String(n).padStart(2, "0")}`, workspace: "team" }),
    );
    const board = ready<Board>({ at: "2026-09-23T02:00:00.000Z", value: readBoard({ rows: placed, unresolved: 0 })! });
    const value = readCardLandings({
      landings: [
        {
          anchor: "talk:a0000041-0000-4000-8000-000000000044",
          atIso: "2026-09-23T01:59:05.000Z",
          cardKey: "ask:acme-00",
          decidedIso: "2026-09-23T01:59:00.000Z",
          source: "relay",
          triage: { label: "waiting-on-them", verdict: "park-working-session" },
          words: "park that for the working session",
          workSlug: "talk-a00000410000",
        },
      ],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    })!;
    const answer = actionItemsAnswer({
      ...allReady(),
      board,
      spoken: ready<CardLandings>({ at: "2026-09-23T02:00:00.000Z", value }),
    });
    expect(answer.items.length).toBe(25);
    expect(answer.items.map((item) => item.key)).not.toContain("ask:acme-00");
    expect(answer.beyondCap).toEqual({ marked: false, more: true, parked: true });
  });

  it("names all ten, and has no instant to report, when nothing has arrived", () => {
    const none = { phase: "loading" } as const;
    const answer = actionItemsAnswer({
      acts: none,
      board: none,
      context: "everything",
      drafts: none,
      hands: none,
      landing: none,
      nowIso: NOW,
      placer: ACME_PLACER,
      posts: none,
      reviewers: none,
      reviews: none,
      imports: none,
      shown: SHOWN_EMPTY,
      shows: () => true,
      spoken: none,
      standing: none,
      currency: { phase: "loading" },
      deferrals: none,
      steers: NO_STEERS,
      workstreams: none,
    });
    expect(answer.unread.map((row) => row.source)).toEqual(SOURCES.map((row) => row.source));
    expect(answer.complete).toBe(false);
    expect(answer.observedAtIso).toBe(undefined);
  });

  it("speaks a staged import question as one item, as the Queue draws it", () => {
    const at = "2026-09-23T04:45:00.000Z";
    const value = readImportQuestions({
      observedAtIso: at,
      questions: [
        {
          actions: ["keep-current", "take-imported"],
          batchId: "00000000-0000-4000-8000-0000000000b2",
          current: "acme-ask-7: review ABC-1 before Friday",
          imported: "acme-ask-7: review ABC-1 before Thursday",
          key: "acme-ask-7",
          kind: "conflict",
          part: "standing-asks",
          questionId: "import-q-00000000000000b2",
          stagedAtIso: "2026-09-22T10:30:00.000Z",
        },
      ],
    })!;
    const answer = actionItemsAnswer({ ...allReady(), imports: ready<ImportQuestionReading>({ at, value }) });
    expect(answer.complete).toBe(true);
    expect(answer.items.map((item) => [item.key, item.kind, item.pill, item.question, item.tier])).toEqual([
      [
        "import:import-q-00000000000000b2",
        "import",
        "import conflict",
        "Keep your current standing-asks row acme-ask-7, or take the imported one?",
        "fleet-blocked",
      ],
    ]);
  });
});

describe("actionItemsAnswer — a card the owner's spoken words landed on", () => {
  /** The `talk cards` reading with one landing on `cardKey`, and refused ledger lines beside it. */
  const spokenOn = ({
    cardKey,
    unreadableLines = [],
  }: {
    cardKey: string;
    unreadableLines?: readonly { readonly lineNumber: number; readonly cardKey?: string }[];
  }): LiveState<CardLandings> => {
    const value = readCardLandings({
      landings: [
        {
          anchor: "call:a0000041-0000-4000-8000-000000000044#s-1",
          cardKey,
          atIso: "2026-09-24T16:30:05.000Z",
          decidedIso: "2026-09-24T16:30:00.000Z",
          source: "transcript",
          words: "is this the one about the Now page",
          workSlug: "talk-card-08327b595da4",
        },
      ],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: unreadableLines.map((line) => line.lineNumber),
      unreadableLines,
    });
    if (value === undefined) {
      throw new Error("the landing fixture did not read");
    }
    return ready<CardLandings>({ at: "2026-09-24T17:00:00.000Z", value });
  };

  // The Alignment page still draws an act whose recut a session is running, so the card tools must too.
  it("keeps an act the owner's words sent for a recut in flight among the Alignment cards, as the page draws it", () => {
    const plate = ownerPlate();
    const board = readBoard({
      rows: [
        ownerAsk({ slug: "chair-respawn", workspace: "self" }),
        { ...ownerAsk({ slug: "talk-card-08327b595da4", workspace: "self" }), run: "active", section: "IN FLIGHT" },
      ],
      unresolved: 0,
    })!;
    const { alignment } = actionItemProjection({
      nowIso: NOW,
      placer: ACME_PLACER,
      readings: {
        ...plate,
        board: ready<Board>({ at: "2026-09-24T17:00:00.000Z", value: board }),
        spoken: spokenOn({ cardKey: "act:edit-pr-17648" }),
      },
    });
    expect(alignment.map((row) => [row.key, row.card.question])).toEqual([
      ["act:edit-pr-17648", "Recut in flight, talk-card-08327b595da4"],
    ]);
  });

  it("is not offered to the owner again — it waits on a session now", () => {
    const answer = actionItemsAnswer({ ...ownerPlate(), spoken: spokenOn({ cardKey: "ask:chair-respawn" }) });
    expect(answer.items.map((item) => item.key)).toEqual(["ask:iso-evidence-door", "hand:try-now-page"]);
    expect(answer.complete).toBe(true);
  });

  it("still offers a hand step an older landing names, since a step settles only when it is done", () => {
    const answer = actionItemsAnswer({ ...ownerPlate(), spoken: spokenOn({ cardKey: "hand:try-now-page" }) });
    expect(answer.items.map((item) => item.key)).toEqual([
      "ask:iso-evidence-door",
      "ask:chair-respawn",
      "hand:try-now-page",
    ]);
  });

  it("still leaves out what did read when some ledger lines did not, and names the gap", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      spoken: spokenOn({ cardKey: "ask:chair-respawn", unreadableLines: [{ lineNumber: 3 }] }),
    });
    expect(answer.items.map((item) => item.key)).not.toContain("ask:chair-respawn");
    expect(answer.unread).toEqual([
      { source: "your spoken steers", why: "1 landing line(s) did not read, so a card you steered may still show" },
    ]);
  });

  it("names a refused line recording a card these registers built, and only that line", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      spoken: spokenOn({
        cardKey: "ask:chair-respawn",
        unreadableLines: [
          { cardKey: "hand:try-now-page", lineNumber: 3 },
          { cardKey: "ask:abc-gone", lineNumber: 4 },
        ],
      }),
    });
    expect(answer.unread).toEqual([
      { source: "your spoken steers", why: "1 landing line(s) did not read, so a card you steered may still show" },
    ]);
    expect(answer.complete).toBe(false);
  });

  // The measured regression: a one-off sanitiser left ledger lines whose card key has a space in it, and lines about
  // cards no longer on the Queue. The voice said "some recorded steers were unreadable" over a card none was about.
  it("names no gap for refused lines about cards not on the Queue, or recording a key that is no card key", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      spoken: spokenOn({
        cardKey: "ask:chair-respawn",
        unreadableLines: [
          { cardKey: "ask:acme-Fixture 1-seats", lineNumber: 3 },
          { cardKey: "pr:acme.Fixture 1.19343", lineNumber: 4 },
          { cardKey: "ask:abc-gone", lineNumber: 5 },
        ],
      }),
    });
    expect(answer.unread).toEqual([]);
    expect(answer.complete).toBe(true);
    expect(answer.items.map((item) => item.key)).toEqual(["ask:iso-evidence-door", "hand:try-now-page"]);
  });

  it("leaves out a card a steer collapsed before its landing has even been read", () => {
    const steers = { ...NO_STEERS, hidden: new Set(["ask:chair-respawn"]) };
    const answer = actionItemsAnswer({ ...ownerPlate(), spoken: { phase: "loading" }, steers });
    expect(answer.items.map((item) => item.key)).toEqual(["ask:iso-evidence-door", "hand:try-now-page"]);
  });

  it("offers again a card a steer came back on, though its landing still holds it", () => {
    const steers = { ...NO_STEERS, revealed: new Set(["ask:chair-respawn"]) };
    const answer = actionItemsAnswer({ ...ownerPlate(), spoken: spokenOn({ cardKey: "ask:chair-respawn" }), steers });
    expect(answer.items.map((item) => item.key)).toContain("ask:chair-respawn");
  });

  it("hides nothing while the overlay is still loading", () => {
    const answer = actionItemsAnswer({ ...ownerPlate(), spoken: { phase: "loading" } });
    expect(answer.items.map((item) => item.key)).toContain("ask:chair-respawn");
  });

  it("lists a card the owner parked after the rest, saying their ruling as the Queue's pill does", () => {
    const plain = actionItemsAnswer({ ...ownerPlate(), spoken: { phase: "loading" } }).items.map((item) => item.key);
    // The card the owner meets first, so moving it after the rest is a change the order shows.
    const parkedKey = plain[0];
    const value = readCardLandings({
      landings: [
        {
          anchor: "talk:a0000041-0000-4000-8000-000000000044",
          atIso: "2026-09-24T16:59:05.000Z",
          cardKey: parkedKey,
          decidedIso: "2026-09-24T16:59:00.000Z",
          source: "relay",
          triage: { label: "waiting-on-them", verdict: "park-working-session" },
          words: "park that for the working session",
          workSlug: "talk-a00000410000",
        },
      ],
      moves: [],
      movesUnreadable: [],
      movesUnreadableLines: [],
      triageUnreadable: 0,
      unreadable: [],
      unreadableLines: [],
    })!;
    const answer = actionItemsAnswer({ ...ownerPlate(), spoken: ready({ at: "2026-09-24T17:00:00.000Z", value }) });
    expect(plain.length).toBeGreaterThan(1);
    expect(answer.items.map((item) => item.key)).toEqual([...plain.filter((key) => key !== parkedKey), parkedKey]);
    expect(answer.items.map((item) => item.parked)).toEqual([
      ...plain.filter((key) => key !== parkedKey).map(() => undefined),
      "Parked, working session · waiting on them",
    ]);
  });
});

// A card removed from the Queue stays visible, marked as removed from it.
describe("actionItemsAnswer — what recently left the owner's Queue", () => {
  const PLATE_AT = "2026-09-24T17:00:00.000Z";

  /** The `talk cards` reading with a landing on `cardKey` at each instant, in the order given. */
  const landedAt = ({ cardKey, at }: { cardKey: string; at: readonly string[] }): LiveState<CardLandings> => {
    const landings = at.map((atIso, n) => ({
      anchor: `call:a0000041-0000-4000-8000-000000000044#s-${String(n)}`,
      atIso,
      cardKey,
      decidedIso: atIso,
      source: "transcript",
      words: `words ${String(n)}`,
      workSlug: `talk-card-${String(n)}`,
    }));
    return ready<CardLandings>({
      at: PLATE_AT,
      value: readCardLandings({
        landings,
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      })!,
    });
  };

  /** One ask that was the owner's, settled at `settledIso`, published as `handover list --json` publishes it. */
  const settledAsk = ({ slug, settledIso }: { slug: string; settledIso: string }): Record<string, unknown> => ({
    ...ownerAsk({ slug, workspace: "self" }),
    lean: "send it",
    options: [
      { letter: "A", option: "send", tradeoff: "the owner reads it today" },
      { letter: "B", option: "hold", tradeoff: "nothing moves" },
    ],
    ownerWait: "not-waiting",
    problem: "the review ask has sat a week",
    question: undefined,
    settledIso,
    settlement: "answered",
    settlementWitness: "the owner said send it",
    summary: `Bump the review on ${slug}?`,
  });

  /** The owner's plate with these board rows in place of its own. */
  const withBoard = ({
    rows,
  }: {
    rows: readonly Record<string, unknown>[];
  }): Parameters<typeof actionItemsAnswer>[0] => ({
    ...ownerPlate(),
    board: ready<Board>({ at: PLATE_AT, value: readBoard({ rows, unresolved: 0 })! }),
  });

  it("lists a card the owner's words took off, dated by the EARLIEST landing and saying whose words, and counts it nowhere", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      spoken: landedAt({ at: ["2026-09-24T17:20:00.000Z", "2026-09-24T17:10:00.000Z"], cardKey: "ask:chair-respawn" }),
    });
    expect(answer.items.map((item) => item.key)).toEqual(["ask:iso-evidence-door", "hand:try-now-page"]);
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed])).toEqual([
      [
        "ask:chair-respawn",
        {
          atIso: "2026-09-24T17:10:00.000Z",
          why: 'Your words, heard by the voice with this card open landed on it ("words 1"); a session acts on it as talk-card-1',
        },
      ],
    ]);
    expect(answer.recentlyLeftBeyondCap).toBe(0);
  });

  it("lists an ask settled off the owner's Queue, read off the board's wire shape, marked with how it ended", () => {
    const answer = actionItemsAnswer(
      withBoard({ rows: [settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" })] }),
    );
    expect(answer.items.map((item) => item.key)).toEqual(["hand:try-now-page"]);
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed])).toEqual([
      [
        "ask:jasper-review-bump",
        { atIso: "2026-09-24T17:30:00.000Z", why: "Settled answered: the owner said send it" },
      ],
    ]);
  });

  // A hand-edited settle instant that does not parse never displaces a landing that does.
  it("dates a settled ask by its landing when the settle instant does not parse", () => {
    const answer = actionItemsAnswer({
      ...withBoard({ rows: [settledAsk({ settledIso: "not-a-date", slug: "jasper-review-bump" })] }),
      spoken: landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:jasper-review-bump" }),
    });
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed.atIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T17:10:00.000Z"],
    ]);
  });

  // A landing instant that does not parse, written first, never displaces a later one that does.
  it("dates a card by its parseable landing when an earlier-written one does not parse", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      spoken: landedAt({ at: ["not-a-date", "2026-09-24T17:10:00.000Z"], cardKey: "ask:chair-respawn" }),
    });
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed.atIso])).toEqual([
      ["ask:chair-respawn", "2026-09-24T17:10:00.000Z"],
    ]);
  });

  // An ask settled before `settledIso` existed is still named by the words that landed on it, as the pack names it.
  it("lists a settled ask with no settle instant by the landing on it", () => {
    const legacy = { ...settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" }) };
    delete legacy["settledIso"];
    const answer = actionItemsAnswer({
      ...withBoard({ rows: [legacy] }),
      spoken: landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:jasper-review-bump" }),
    });
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed.atIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T17:10:00.000Z"],
    ]);
  });

  // Two board rows sharing a slug name the earlier removal, whichever the board printed first.
  it("names the earlier settle when two board rows share a slug", () => {
    const later = settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" });
    const earlier = settledAsk({ settledIso: "2026-09-24T17:20:00.000Z", slug: "jasper-review-bump" });
    const left = actionItemsAnswer(withBoard({ rows: [later, earlier] })).recentlyLeft;
    expect(left.map((one) => [one.key, one.removed.atIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T17:20:00.000Z"],
    ]);
  });

  // A ruled ask is off the owner's Queue from the ruling, before any session settles it.
  it("lists an ask the owner ruled on and nobody has settled, dated by the ruling", () => {
    const ruled = {
      ...ownerAsk({ slug: "jasper-review-bump", workspace: "self" }),
      ownerWait: "already-ruled",
      ruledSinceQuestionIso: "2026-09-24T17:05:00.000Z",
    };
    const left = actionItemsAnswer(withBoard({ rows: [ruled] })).recentlyLeft;
    expect(left.map((one) => [one.key, one.removed])).toEqual([
      [
        "ask:jasper-review-bump",
        { atIso: "2026-09-24T17:05:00.000Z", why: "You ruled on it; it waits on a session to execute that" },
      ],
    ]);
    // A doc run's question the Queue drew as the owner's ask leaves it at the ruling the same way.
    const doc = actionItemsAnswer(withBoard({ rows: [{ ...ruled, kind: "doc" }] })).recentlyLeft;
    expect(doc.map((one) => [one.key, one.removed.atIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T17:05:00.000Z"],
    ]);
    // A doc run that ended still carrying its question is named by the words that landed on it.
    const ended = { ...ruled, kind: "doc", ownerWait: "settled", ruledSinceQuestionIso: undefined };
    const endedLeft = actionItemsAnswer({
      ...withBoard({ rows: [ended] }),
      spoken: landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:jasper-review-bump" }),
    }).recentlyLeft;
    expect(endedLeft.map((one) => [one.key, one.removed.atIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T17:10:00.000Z"],
    ]);
    // And one a session settled is dated by that settle, with no landing at all.
    const settledDoc = {
      ...settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "doc-question" }),
      kind: "doc",
      ownerWait: "settled",
      question: "Approve this?",
    };
    const settledLeft = actionItemsAnswer(withBoard({ rows: [settledDoc] })).recentlyLeft;
    expect(settledLeft.map((one) => [one.key, one.removed.atIso])).toEqual([
      ["ask:doc-question", "2026-09-24T17:30:00.000Z"],
    ]);
  });

  // A ruling instant that does not parse never displaces the settle's.
  it("dates a settled ask by its settle when the ruling instant does not parse", () => {
    const ruled = {
      ...settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" }),
      ruledBeforeSettleIso: "not-a-date",
      ruledBeforeSettleWords: "send it",
    };
    expect(actionItemsAnswer(withBoard({ rows: [ruled] })).recentlyLeft.map((left) => left.removed)).toEqual([
      { atIso: "2026-09-24T17:30:00.000Z", why: "Settled answered: the owner said send it" },
    ]);
  });

  // A landing at the settle's own instant did not come before it, as the pack holds too.
  it("dates a settled ask by its settle when a landing shares its instant", () => {
    const answer = actionItemsAnswer({
      ...withBoard({ rows: [settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" })] }),
      spoken: landedAt({ at: ["2026-09-24T17:30:00.000Z"], cardKey: "ask:jasper-review-bump" }),
    });
    expect(answer.recentlyLeft.map((left) => left.removed)).toEqual([
      { atIso: "2026-09-24T17:30:00.000Z", why: "Settled answered: the owner said send it" },
    ]);
  });

  // A live ask needs only its question, so a settled one with no summary was a card too.
  it("lists a settled ask with no summary, dated by its settle", () => {
    const bare = {
      ...settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "no-summary" }),
      question: "Approve X?",
      summary: undefined,
    };
    const answer = actionItemsAnswer(withBoard({ rows: [bare] }));
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed.atIso])).toEqual([
      ["ask:no-summary", "2026-09-24T17:30:00.000Z"],
    ]);
  });

  // A ruled ask reads `already-ruled` and is off the owner's Queue from the ruling, before a session settles it.
  it("dates an ask the owner ruled on before it settled by the ruling, in their words, then the settle", () => {
    const ruled = {
      ...settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" }),
      ruledBeforeSettleIso: "2026-09-24T15:00:00.000Z",
      ruledBeforeSettleWords: "send it",
    };
    expect(actionItemsAnswer(withBoard({ rows: [ruled] })).recentlyLeft.map((left) => left.removed)).toEqual([
      {
        atIso: "2026-09-24T15:00:00.000Z",
        why: 'You ruled on it ("send it"), then it settled answered: the owner said send it',
      },
    ]);
  });

  it("never lists a settled row that was never the owner's card — a voice relay row carries no decision shape", () => {
    const relay = {
      ...settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "talk-7541725c4b3b" }),
      lean: undefined,
      options: undefined,
      problem: undefined,
    };
    expect(actionItemsAnswer(withBoard({ rows: [relay] })).recentlyLeft).toEqual([]);
  });

  it("lists a card a steer collapsed, dated by when the owner spoke", () => {
    const collapsed = {
      cardKey: "ask:chair-respawn",
      heard: "park the Now page",
      relaySlug: undefined,
      sentAtIso: "2026-09-24T17:40:00.000Z",
      turnId: "turn-1",
    } as const;
    const steers = { ...NO_STEERS, collapsed: [collapsed], hidden: new Set(["ask:chair-respawn"]) };
    const answer = actionItemsAnswer({ ...ownerPlate(), spoken: { phase: "loading" }, steers });
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed])).toEqual([
      [
        "ask:chair-respawn",
        {
          atIso: "2026-09-24T17:40:00.000Z",
          why: 'Your words, relayed by the voice, collapsed it ("park the Now page")',
        },
      ],
    ]);
  });

  // A steer collapsing the card before the owner's words landed on it took it off first.
  it("dates a card a steer collapsed and words then landed on by whichever came first", () => {
    const collapsedAt = ({ sentAtIso }: { sentAtIso: string }) =>
      ({
        cardKey: "ask:chair-respawn",
        heard: "park the Now page",
        relaySlug: undefined,
        sentAtIso,
        turnId: "turn-1",
      }) as const;
    const removedWith = ({ sentAtIso }: { sentAtIso: string }) =>
      actionItemsAnswer({
        ...ownerPlate(),
        spoken: landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:chair-respawn" }),
        steers: { ...NO_STEERS, collapsed: [collapsedAt({ sentAtIso })], hidden: new Set(["ask:chair-respawn"]) },
      }).recentlyLeft.map((left) => left.removed);
    expect(removedWith({ sentAtIso: "2026-09-24T17:00:00.000Z" })).toEqual([
      {
        atIso: "2026-09-24T17:00:00.000Z",
        why: 'Your words, relayed by the voice, collapsed it ("park the Now page")',
      },
    ]);
    expect(removedWith({ sentAtIso: "2026-09-24T17:40:00.000Z" })).toEqual([
      {
        atIso: "2026-09-24T17:10:00.000Z",
        why: 'Your words, heard by the voice with this card open landed on it ("words 0"); a session acts on it as talk-card-0',
      },
    ]);
  });

  // Of two collapses still pending the first took the card off, unless a steer came back between them.
  it("dates a card two steers collapsed by the first since the last one that came back", () => {
    const steer = ({ sentAtIso, heard }: { sentAtIso: string; heard: string }) =>
      ({
        cardKey: "ask:chair-respawn",
        heard,
        relaySlug: undefined,
        sentAtIso,
        turnId: heard,
      }) as const;
    const collapsed = [
      steer({ heard: "second steer", sentAtIso: "2026-09-24T17:20:00.000Z" }),
      steer({ heard: "first steer", sentAtIso: "2026-09-24T17:00:00.000Z" }),
    ];
    const removedWith = ({ cameBack }: { cameBack: SteerOverlay["cameBack"] }) =>
      actionItemsAnswer({
        ...ownerPlate(),
        spoken: { phase: "loading" },
        steers: { ...NO_STEERS, cameBack, collapsed, hidden: new Set(["ask:chair-respawn"]) },
      }).recentlyLeft.map((left) => left.removed);
    expect(removedWith({ cameBack: [] })).toEqual([
      { atIso: "2026-09-24T17:00:00.000Z", why: 'Your words, relayed by the voice, collapsed it ("first steer")' },
    ]);
    const between = { cardKey: "ask:chair-respawn", sentAtIso: "2026-09-24T17:10:00.000Z", turnId: "back" };
    expect(removedWith({ cameBack: [between] })).toEqual([
      { atIso: "2026-09-24T17:20:00.000Z", why: 'Your words, relayed by the voice, collapsed it ("second steer")' },
    ]);
  });

  // The state read by the page's own hide rule: a landing whose steer came back but was never revealed
  // kept the card off from the moment it landed, so a later collapse does not re-date it.
  it("dates a card held by a landing whose steer came back unrevealed by that landing, not a later collapse", () => {
    const landing = {
      anchor: "talk:r1",
      atIso: "2026-09-24T17:00:00.000Z",
      cardKey: "ask:chair-respawn",
      decidedIso: "2026-09-24T17:00:00.000Z",
      source: "relay",
      words: "park it",
      workSlug: "talk-r1",
    };
    const collapsed = {
      cardKey: "ask:chair-respawn",
      heard: "park it again",
      relaySlug: undefined,
      sentAtIso: "2026-09-24T17:30:00.000Z",
      turnId: "r2",
    } as const;
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      spoken: ready<CardLandings>({
        at: PLATE_AT,
        value: readCardLandings({
          landings: [landing],
          moves: [],
          movesUnreadable: [],
          movesUnreadableLines: [],
          triageUnreadable: 0,
          unreadable: [],
          unreadableLines: [],
        })!,
      }),
      steers: {
        ...NO_STEERS,
        cameBack: [{ cardKey: "ask:chair-respawn", sentAtIso: "2026-09-24T16:59:00.000Z", turnId: "r1" }],
        collapsed: [collapsed],
        hidden: new Set(["ask:chair-respawn"]),
      },
    });
    expect(answer.items.map((item) => item.key)).not.toContain("ask:chair-respawn");
    expect(answer.recentlyLeft.map((left) => left.removed)).toEqual([
      {
        atIso: "2026-09-24T17:00:00.000Z",
        why: 'Your words, relayed by the voice landed on it ("park it"); no session picked that steer up',
      },
    ]);
  });

  it("lists nothing for a card a steer brought back, though a landing still names it", () => {
    const answer = actionItemsAnswer({
      ...ownerPlate(),
      spoken: landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:chair-respawn" }),
      steers: { ...NO_STEERS, revealed: new Set(["ask:chair-respawn"]) },
    });
    expect(answer.items.map((item) => item.key)).toContain("ask:chair-respawn");
    expect(answer.recentlyLeft).toEqual([]);
  });

  it("lists nothing removed more than a day before the caller's clock, nor after it", () => {
    const spoken = landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:chair-respawn" });
    const dayLater = actionItemsAnswer({ ...ownerPlate(), nowIso: "2026-09-25T17:10:00.001Z", spoken });
    const atTheEdge = actionItemsAnswer({ ...ownerPlate(), nowIso: "2026-09-25T17:10:00.000Z", spoken });
    const before = actionItemsAnswer({ ...ownerPlate(), nowIso: "2026-09-24T17:09:59.999Z", spoken });
    expect([dayLater.recentlyLeft.length, atTheEdge.recentlyLeft.length, before.recentlyLeft.length]).toEqual([
      0, 1, 0,
    ]);
  });

  it("says the instant Date.parse measured, never a date no calendar has", () => {
    const answer = actionItemsAnswer({
      ...withBoard({ rows: [settledAsk({ settledIso: "2026-02-30T12:00:00.000Z", slug: "jasper-review-bump" })] }),
      nowIso: "2026-03-03T11:00:00.000Z",
    });
    expect(answer.recentlyLeft.map((left) => left.removed.atIso)).toEqual(["2026-03-02T12:00:00.000Z"]);
  });

  it("lists nothing the work context hides", () => {
    const spoken = landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:chair-respawn" });
    expect(actionItemsAnswer({ ...ownerPlate(), shows: () => false, spoken }).recentlyLeft).toEqual([]);
  });

  it("lists each card once, by the words that took it off before the settle that followed", () => {
    const answer = actionItemsAnswer({
      ...withBoard({ rows: [settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" })] }),
      spoken: landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:jasper-review-bump" }),
    });
    expect(answer.recentlyLeft.map((left) => [left.key, left.removed.atIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T17:10:00.000Z"],
    ]);
  });

  // A landing written after the settle did not take the card off; the settle did, earlier.
  it("keeps the settle when words landed on the card only after it settled", () => {
    const answer = actionItemsAnswer({
      ...withBoard({ rows: [settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" })] }),
      spoken: landedAt({ at: ["2026-09-24T17:40:00.000Z"], cardKey: "ask:jasper-review-bump" }),
    });
    expect(answer.recentlyLeft.map((left) => left.removed)).toEqual([
      { atIso: "2026-09-24T17:30:00.000Z", why: "Settled answered: the owner said send it" },
    ]);
  });

  it("finds through read_card a card the owner's words landed on and a session then settled, marked removed, opening nothing", async () => {
    const readings = {
      ...withBoard({ rows: [settledAsk({ settledIso: "2026-09-24T17:30:00.000Z", slug: "jasper-review-bump" })] }),
      spoken: landedAt({ at: ["2026-09-24T17:10:00.000Z"], cardKey: "ask:jasper-review-bump" }),
    };
    const { live, recentlyLeft } = actionItemProjection({ nowIso: NOW, placer: ACME_PLACER, readings });
    const ran = await runReadCard({
      args: { key: "ask:jasper-review-bump" },
      seams: {
        actLookup: async () => {
          throw new Error("no act is looked up here");
        },
        cards: () => ({
          alignment: NO_ALIGNMENT_CARDS,
          focuses: [],
          fromPath: "/queue",
          recentlyLeft,
          rows: live,
          unread: [],
        }),
        readBriefing: async ({ slug }) => ({ ok: false, why: `no briefing expected, asked for ${slug}` }),
      },
    });
    expect([ran.refused, ran.detail]).toEqual([false, "ask:jasper-review-bump, read (off the owner's Queue)"]);
    expect((ran.answer as { removed: unknown }).removed).toEqual({
      atIso: "2026-09-24T17:10:00.000Z",
      onQueue: false,
      why: 'Your words, heard by the voice with this card open landed on it ("words 0"); a session acts on it as talk-card-0',
    });
  });

  it("orders the newest removal first and counts the ones past the cap rather than dropping them unsaid", () => {
    const rows = Array.from({ length: 12 }, (_, n) =>
      settledAsk({
        settledIso: `2026-09-24T17:${String(10 + n)}:00.000Z`,
        slug: `settled-${String(n).padStart(2, "0")}`,
      }),
    );
    const answer = actionItemsAnswer(withBoard({ rows }));
    expect(answer.recentlyLeft.map((left) => left.key)).toEqual([
      "ask:settled-11",
      "ask:settled-10",
      "ask:settled-09",
      "ask:settled-08",
      "ask:settled-07",
      "ask:settled-06",
      "ask:settled-05",
      "ask:settled-04",
      "ask:settled-03",
      "ask:settled-02",
    ]);
    expect(answer.recentlyLeftBeyondCap).toBe(2);
  });
});
