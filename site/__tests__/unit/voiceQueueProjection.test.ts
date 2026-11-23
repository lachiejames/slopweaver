import { describe, expect, it } from "vitest";
import { allDrawnOf, missingOf, parkedRegistersOf } from "../../components/console/useQueueRowsReading";
import { type Board, type HandStep, readBoard } from "../../components/live/read";
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
import {
  sameVoiceQueueInputs,
  type VoiceQueueInputs,
  voiceQueueProjector,
  voiceQueueShownReading,
} from "../../components/voice/voiceQueueProjection";
import { CURRENCY_CHECK, type CurrencyReading } from "../../lib/cardCurrency";
import { projectQueue, type QueueProjectionReadings } from "../../lib/queueProjection";
import { NO_STEERS } from "../../lib/steeredCards";
import { readWorkstreamTiles, type WorkstreamsView } from "../../lib/workstreamTiles";
import { ACME_PLACER } from "../organisationFixture";

import { LANDING, NO_CURRENCY, NO_REVIEWERS, ready } from "./actionItemReadingsFixture";
import { documentWith } from "./workstreamTilesFixture";

const AT = "2026-11-18T08:00:00.000Z";

/** One ask on the board waiting on the owner's word. */
function ownerAsk({ slug }: { slug: string }): Record<string, unknown> {
  return {
    kind: "ask",
    ownerWait: "owner",
    question: `Which way on ${slug}?`,
    questionAskedIso: "2026-11-17T11:00:00.000Z",
    reason: "waiting on the owner",
    section: "runnable",
    slug,
    status: "waiting-on-owner",
    workspace: "team",
  };
}

/**
 * The board as it arrived, holding an ask for each slug.
 *
 * @returns the ready board
 */
function boardOf({ slugs }: { slugs: readonly string[] }): QueueProjectionReadings["board"] {
  return ready<Board>({ at: AT, value: readBoard({ rows: slugs.map((slug) => ownerAsk({ slug })), unresolved: 0 })! });
}

/**
 * Every reading the projection takes, all arrived and empty but the board.
 *
 * @returns the readings
 */
function readingsWith({ board }: { board: QueueProjectionReadings["board"] }): QueueProjectionReadings {
  return {
    acts: ready<readonly AutonomyRow[]>({ at: AT, value: [] }),
    board,
    currency: ready<Reading<CurrencyReading>>({ at: AT, value: NO_CURRENCY }),
    deferrals: ready<CardDeferrals>({ at: AT, value: { deferrals: [], unreadable: 0 } }),
    drafts: ready<readonly HeldDraft[]>({ at: AT, value: [] }),
    hands: ready<readonly HandStep[]>({ at: AT, value: [] }),
    imports: ready<ImportQuestionReading>({ at: AT, value: { questions: [] } }),
    landing: ready<LandingReading>({ at: AT, value: LANDING }),
    posts: ready<readonly ParkedDraft[]>({ at: AT, value: [] }),
    reviewers: ready<Reviewers>({ at: AT, value: NO_REVIEWERS }),
    reviews: ready<readonly ParkedReview[]>({ at: AT, value: [] }),
    spoken: ready<CardLandings>({
      at: AT,
      value: { landings: [], moves: [], triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
    }),
    standing: ready<StandingAskReading>({ at: AT, value: { active: [], kind: "read" } }),
    workstreams: ready<WorkstreamsView>({
      at: AT,
      value: readWorkstreamTiles({ payload: documentWith({ workstreams: [] }) })!,
    }),
  };
}

const NO_SETTLED: readonly string[] = [];

/**
 * The voice's inputs over a board holding these asks.
 *
 * @returns the inputs
 */
function inputsOf({ slugs }: { slugs: readonly string[] }): VoiceQueueInputs {
  return {
    placer: ACME_PLACER,
    readings: readingsWith({ board: boardOf({ slugs }) }),
    settled: NO_SETTLED,
    steers: NO_STEERS,
  };
}

describe("projectQueue", () => {
  it("draws every ask on the board, in both work contexts", () => {
    const projection = projectQueue(inputsOf({ slugs: ["alpha", "beta"] }));

    expect(projection.every.map((row) => row.key).toSorted()).toEqual(["ask:alpha", "ask:beta"]);
    expect(projection.placeable.map((row) => row.key).toSorted()).toEqual(["ask:alpha", "ask:beta"]);
    expect(projection.withheldEvery).toEqual([]);
  });

  it("keeps a row a press just settled in every, and out of what stands", () => {
    const projection = projectQueue({ ...inputsOf({ slugs: ["alpha", "beta"] }), settled: ["ask:alpha"] });

    expect(projection.every.map((row) => row.key).toSorted()).toEqual(["ask:alpha", "ask:beta"]);
    expect(projection.placeable.map((row) => row.key)).toEqual(["ask:beta"]);
  });
});

describe("voiceQueueProjector", () => {
  it("projects nothing until asked, then keeps the projection while every input is the same object", () => {
    const project = voiceQueueProjector();
    const inputs = inputsOf({ slugs: ["alpha"] });

    const first = project({ inputs });
    // A render builds a fresh wrapper around the very same readings: still the same inputs.
    const again = project({ inputs: { ...inputs, readings: { ...inputs.readings } } });

    expect(again).toBe(first);
    expect(first.every.map((row) => row.key)).toEqual(["ask:alpha"]);
  });

  it("projects again once any reading arrives anew", () => {
    const project = voiceQueueProjector();
    const inputs = inputsOf({ slugs: ["alpha"] });
    const first = project({ inputs });

    const next = project({
      inputs: { ...inputs, readings: { ...inputs.readings, board: boardOf({ slugs: ["alpha", "beta"] }) } },
    });

    expect(next).not.toBe(first);
    expect(next.every.map((row) => row.key).toSorted()).toEqual(["ask:alpha", "ask:beta"]);
  });

  it("projects again when a press settles a row", () => {
    const project = voiceQueueProjector();
    const inputs = inputsOf({ slugs: ["alpha", "beta"] });
    project({ inputs });

    const settled = project({ inputs: { ...inputs, settled: ["ask:beta"] } });

    expect(settled.placeable.map((row) => row.key)).toEqual(["ask:alpha"]);
  });
});

describe("sameVoiceQueueInputs", () => {
  it("tells a newly delivered reading from the same one, even when both say the same", () => {
    const inputs = inputsOf({ slugs: ["alpha"] });
    const redelivered = {
      ...inputs,
      readings: { ...inputs.readings, hands: ready<readonly HandStep[]>({ at: AT, value: [] }) },
    };

    expect(sameVoiceQueueInputs({ left: inputs, right: { ...inputs } })).toBe(true);
    expect(sameVoiceQueueInputs({ left: inputs, right: redelivered })).toBe(false);
  });
});

describe("voiceQueueShownReading", () => {
  it("counts only the rows the asking context shows, with every register drawn and nothing missing", () => {
    const inputs = inputsOf({ slugs: ["alpha", "beta"] });
    const reading = voiceQueueShownReading({
      context: "work",
      projection: projectQueue(inputs),
      readings: inputs.readings,
      shows: (row) => row.key === "ask:beta",
      steersRead: true,
    });

    expect(reading.rows.map((row) => row.key)).toEqual(["ask:beta"]);
    // The other half of the same split, which the page says it hides.
    expect(reading.otherRows.map((row) => row.key)).toEqual(["ask:alpha"]);
    expect(reading.context).toBe("work");
    expect([reading.allDrawn, reading.splitRead]).toEqual([true, true]);
    expect(reading.missing).toEqual([]);
  });

  it("calls the context split unread while workstreams is still loading, as the page's own reading does", () => {
    const inputs = inputsOf({ slugs: ["alpha"] });
    const readings: QueueProjectionReadings = { ...inputs.readings, workstreams: { phase: "loading" } };
    const reading = voiceQueueShownReading({
      context: "work",
      projection: projectQueue({ ...inputs, readings }),
      readings,
      shows: () => true,
      steersRead: true,
    });

    expect([reading.allDrawn, reading.splitRead]).toEqual([true, false]);
  });

  it("calls the context split unread while workstreams draws only a reading handed over before this page's first answer", () => {
    const inputs = inputsOf({ slugs: ["alpha"] });
    const handedOver: QueueProjectionReadings["workstreams"] = {
      fixture: undefined,
      observedAtIso: AT,
      phase: "ready",
      refreshing: true,
      stampedByRoute: false,
      value: readWorkstreamTiles({ payload: documentWith({ workstreams: [] }) })!,
    };
    const readings: QueueProjectionReadings = { ...inputs.readings, workstreams: handedOver };
    const reading = voiceQueueShownReading({
      context: "work",
      projection: projectQueue({ ...inputs, readings }),
      readings,
      shows: () => true,
      steersRead: true,
    });

    expect([reading.allDrawn, reading.splitRead]).toEqual([true, false]);
  });

  it("calls the context split unread while the steers reading is unread, every register drawn", () => {
    // A held steer takes its card off the list until the steers reading confirms it, so the split can be a card short.
    const inputs = inputsOf({ slugs: ["alpha"] });
    const reading = voiceQueueShownReading({
      context: "work",
      projection: projectQueue(inputs),
      readings: inputs.readings,
      shows: () => true,
      steersRead: false,
    });

    expect([reading.allDrawn, reading.splitRead]).toEqual([true, false]);
  });

  it("names a register still loading and the unread currency check as missing, and the cards as not all drawn", () => {
    const inputs = inputsOf({ slugs: ["alpha"] });
    const readings: QueueProjectionReadings = {
      ...inputs.readings,
      currency: { phase: "loading" },
      drafts: { phase: "loading" },
    };
    const reading = voiceQueueShownReading({
      context: "slopweaver",
      projection: projectQueue({ ...inputs, readings }),
      readings,
      shows: () => true,
      steersRead: true,
    });

    expect(reading.missing).toEqual(["held replies", CURRENCY_CHECK]);
    expect(reading.allDrawn).toBe(false);
  });
});

describe("missingOf", () => {
  it("calls a register drawing an earlier reading over a failed poll missing, while its cards stay drawn", () => {
    const { board, currency, drafts, hands, imports, landing, posts, reviews, spoken } = readingsWith({
      board: boardOf({ slugs: ["alpha"] }),
    });
    expect(board.phase).toBe("ready");
    const stale: QueueProjectionReadings["board"] = {
      fixture: undefined,
      observedAtIso: AT,
      phase: "ready",
      stale: { why: "the board verb timed out" },
      stampedByRoute: false,
      value: readBoard({ rows: [ownerAsk({ slug: "alpha" })], unresolved: 0 })!,
    };
    const registers = parkedRegistersOf({
      readings: { board: stale, drafts, hands, imports, landing, posts, reviews },
    });

    expect(missingOf({ cardKeys: new Set(), currency, registers, spoken })).toEqual(["recorded asks"]);
    expect(allDrawnOf({ registers })).toBe(true);
  });
});
