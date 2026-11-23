/*
 * A Queue tool's answer from the record, checked against the Queue on screen: the
 * screen's counts and order only where the screen is the record's Queue, and the console never moved to a card the
 * screen has not drawn.
 */
import { describe, expect, it } from "vitest";

import { TOOL_OUTPUT_MAX, toolOutputOf } from "../../components/live/talkSession";
import { SCREEN_QUEUE_SOURCE } from "../../lib/queueScreenVoice";
import { queueScopeOf, queueShownCounts, shownForVoice } from "../../lib/queueShownCounts";
import { NO_STEERS } from "../../lib/steeredCards";
import type { ActionItemReadings } from "../../lib/talkActionItems";
import { UNREAD_MAX_BYTES } from "../../lib/unreadFit";
import {
  cardOnlyUnreadOf,
  type HeldCards,
  recordQueueAnswer,
  recordThenScreen,
  screenBehindWhy,
  screenBy,
  trackedCardReads,
  undrawnNowWhy,
  undrawnWhyOf,
  withCardsUnread,
} from "../../lib/voiceRecordQueue";
import { ACME_PLACER } from "../organisationFixture";
import { ready } from "./actionItemReadingsFixture";
import { askRow } from "./queueVoiceFixture";

const base = askRow();
const row = ({ key, tier = base.tier }: { key: string; tier?: typeof base.tier }): typeof base => ({
  ...base,
  key,
  tier,
});

/** A record none of whose sources has answered: it projects no card. */
const LOADING: ActionItemReadings = {
  acts: { phase: "loading" },
  board: { phase: "loading" },
  currency: { phase: "loading" },
  deferrals: { phase: "loading" },
  drafts: { phase: "loading" },
  hands: { phase: "loading" },
  imports: { phase: "loading" },
  landing: { phase: "loading" },
  posts: { phase: "loading" },
  reviewers: { phase: "loading" },
  reviews: { phase: "loading" },
  spoken: { phase: "loading" },
  standing: { phase: "loading" },
  steers: NO_STEERS,
  workstreams: { phase: "loading" },
};

/** The counts a screen drawing no card prints, every one printed. */
const SHOWN = queueShownCounts({
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
 * The cards a screen draws.
 *
 * @param rows its Queue rows
 * @returns the cards, no act, focus or departure among them
 */
function screenCards({ rows }: { rows: HeldCards["rows"] }): HeldCards {
  return { acts: [], focuses: [], recentlyLeft: [], rows };
}

/**
 * The answer over the loading record, against one screen.
 *
 * @param screen what the screen showed
 * @returns the answer
 */
function answerOver({ screen }: { screen: Parameters<typeof recordQueueAnswer>[0]["screen"] }) {
  return recordQueueAnswer({
    context: "work",
    nowIso: "2026-11-09T00:00:00.000Z",
    placer: ACME_PLACER,
    readings: LOADING,
    screen,
    shows: () => true,
    view: "all",
  });
}

describe("screenBehindWhy", () => {
  it("finds nothing when both hold the same cards at the same tiers, whatever their order", () => {
    const record = [row({ key: "ask:acme-1" }), row({ key: "ask:acme-2" })];
    expect(screenBehindWhy({ record, screen: record.toReversed() })).toBe(undefined);
  });

  it("names each side's extra card, and a card at another tier on both", () => {
    const record = [row({ key: "ask:acme-1", tier: "team-blocked" }), row({ key: "ask:acme-new" })];
    const screen = [row({ key: "ask:acme-1", tier: "check-in" }), row({ key: "ask:acme-gone" })];
    expect(screenBehindWhy({ record, screen })).toBe(
      "the Queue on screen is not the record read just now, so its counts and order are unread: " +
        `the record holds ask:acme-1 (team-blocked), ask:acme-new (${base.tier}) and the screen does not; ` +
        `the screen still draws ask:acme-1 (check-in), ask:acme-gone (${base.tier}) and the record does not`,
    );
  });
});

describe("undrawnWhyOf", () => {
  const screen = {
    cards: screenCards({ rows: [row({ key: "ask:acme-1" })] }),
    drawn: undefined,
    kind: "seen",
    shown: SHOWN,
  } as const;

  it("lets the console move to a card the screen draws", () => {
    expect(undrawnWhyOf({ key: "ask:acme-1", screen })).toBe(undefined);
  });

  it("holds the console still for a card only the record holds", () => {
    expect(undrawnWhyOf({ key: "ask:acme-new", screen })).toBe(
      "ask:acme-new is on the record, read just now, but the console on screen has not drawn it yet, so it was not moved",
    );
  });

  it("holds the console still when the screen did not reach the voice", () => {
    expect(undrawnWhyOf({ key: "ask:acme-1", screen: { kind: "unreached", why: "deadline" } })).toBe(
      "the Queue on screen did not reach the voice, so the console was not moved: deadline",
    );
  });
});

describe("the screen is asked at the boundary, never at the start of the record read", () => {
  /** A screen that draws one card, then another once the page moved. */
  const drawing = ({ key }: { key: string }) =>
    ({ cards: screenCards({ rows: [row({ key })] }), drawn: undefined, kind: "seen", shown: SHOWN }) as const;

  it("pairs the record with the screen as it stood once the record arrived, not as it stood when the read began", async () => {
    let onScreen = drawing({ key: "ask:acme-before" });
    const asks: string[] = [];
    const read = await recordThenScreen({
      record: async () => {
        asks.push("record");
        // The owner moves the page while the record read is out.
        onScreen = drawing({ key: "ask:acme-after" });
        return "the record";
      },
      screen: async () => {
        asks.push("screen");
        return onScreen;
      },
    });
    expect(asks).toEqual(["record", "screen"]);
    expect(read).toEqual({ record: "the record", screen: drawing({ key: "ask:acme-after" }) });
  });

  it("holds the console still for a card the screen drew at the record read but has stopped drawing since", async () => {
    const atRead = drawing({ key: "ask:acme-1" });
    expect(undrawnWhyOf({ key: "ask:acme-1", screen: atRead })).toBe(undefined);
    const now = async () => drawing({ key: "ask:acme-2" });
    expect(await undrawnNowWhy({ key: "ask:acme-1", screen: now })).toBe(
      "ask:acme-1 is on the record, read just now, but the console on screen has not drawn it yet, so it was not moved",
    );
  });

  it("moves the console to a card the screen draws at the move", async () => {
    expect(await undrawnNowWhy({ key: "ask:acme-2", screen: async () => drawing({ key: "ask:acme-2" }) })).toBe(
      undefined,
    );
  });
});

describe("screenBy: every screen ask inside the Queue tool's one deadline", () => {
  const SEEN = { cards: screenCards({ rows: [] }), drawn: [], kind: "seen", shown: SHOWN } as const;
  const LATE = { kind: "unreached", why: "the Queue tool's time ran out before the Queue on screen answered" };

  /**
   * A timer the test fires by hand, recording how long it was set for and whether it was cancelled.
   *
   * @returns the seam, what it was asked for, and the hand that fires it
   */
  function handTimer() {
    const asked: string[] = [];
    let fire = (): void => undefined;
    const after = ({ ms }: { readonly ms: number }) => {
      asked.push(`set ${String(ms)}`);
      const done = new Promise<void>((resolve) => {
        fire = resolve;
      });
      return { cancel: () => asked.push("cancel"), done };
    };
    return { after, asked, fire: () => fire() };
  }

  it("never asks a screen once the deadline has passed, and names the screen unreached", async () => {
    const timer = handTimer();
    const asks: string[] = [];
    const seen = await screenBy({
      after: timer.after,
      ask: async () => {
        asks.push("asked");
        return SEEN;
      },
      deadlineAtMs: 20_000,
      nowMs: () => 20_000,
    });
    expect([seen, asks, timer.asked]).toEqual([LATE, [], []]);
  });

  // The clock read before the timer's setup let a screen be asked once its time was up.
  it("never asks a screen when the deadline passes while the timer is being set", async () => {
    const timer = handTimer();
    const asks: string[] = [];
    const readings = [19_999, 20_000];
    const seen = await screenBy({
      after: timer.after,
      ask: async () => {
        asks.push("asked");
        return SEEN;
      },
      deadlineAtMs: 20_000,
      nowMs: () => readings.shift()!,
    });
    expect([seen, asks, timer.asked]).toEqual([LATE, [], ["set 1", "cancel"]]);
  });

  // A timer sized off the first reading, armed late, ran the wait past the deadline.
  it("re-arms the timer off the last reading, so time lost before it was armed never stretches the wait", async () => {
    const timer = handTimer();
    const asks: string[] = [];
    const readings = [19_000, 19_500];
    const pending = screenBy({
      after: timer.after,
      ask: () => {
        asks.push("asked");
        return new Promise<never>(() => undefined);
      },
      deadlineAtMs: 20_000,
      nowMs: () => readings.shift()!,
    });
    timer.fire();
    const seen = await pending;
    expect([seen, asks, timer.asked]).toEqual([LATE, ["asked"], ["set 1000", "cancel", "set 500", "cancel"]]);
  });

  it("answers with the screen when it arrives in time, the timer set to what is left and then cancelled", async () => {
    const timer = handTimer();
    const seen = await screenBy({
      after: timer.after,
      ask: async () => SEEN,
      deadlineAtMs: 20_000,
      nowMs: () => 18_500,
    });
    expect([seen, timer.asked]).toEqual([SEEN, ["set 1500", "cancel"]]);
  });

  it("names the screen unreached when the deadline comes first, so open_card leaves the console where it was", async () => {
    const timer = handTimer();
    const raced = screenBy({
      after: timer.after,
      ask: () => new Promise<never>(() => undefined),
      deadlineAtMs: 20_000,
      nowMs: () => 17_000,
    });
    timer.fire();
    const seen = await raced;
    expect([seen, timer.asked]).toEqual([LATE, ["set 3000", "cancel"]]);
    expect(undrawnWhyOf({ key: "ask:acme-1", screen: seen })).toBe(
      "the Queue on screen did not reach the voice, so the console was not moved: " +
        "the Queue tool's time ran out before the Queue on screen answered",
    );
  });
});

describe("recordQueueAnswer", () => {
  it("carries the screen's counts when the screen is the record's Queue", () => {
    const answer = answerOver({ screen: { cards: screenCards({ rows: [] }), drawn: [], kind: "seen", shown: SHOWN } });
    expect(answer.shown).toEqual(shownForVoice({ shown: SHOWN }));
    expect(answer.unread.map((one) => one.source)).not.toContain(SCREEN_QUEUE_SOURCE);
  });

  it("reads every count unread, and names why, when the screen still draws a card the record does not", () => {
    const screen = {
      cards: screenCards({ rows: [row({ key: "ask:acme-gone" })] }),
      drawn: ["ask:acme-gone"],
      kind: "seen",
      shown: SHOWN,
    } as const;
    const answer = answerOver({ screen });
    expect(answer.unread.at(-1)).toEqual({
      source: SCREEN_QUEUE_SOURCE,
      why:
        "the Queue on screen is not the record read just now, so its counts and order are unread: " +
        `the screen still draws ask:acme-gone (${base.tier}) and the record does not`,
    });
    expect(Object.values(answer.shown).every((count) => count === "unread")).toBe(true);
    expect([answer.complete, answer.items]).toEqual([false, []]);
  });

  // The difference is added after the answer's fit, so a screen far from the record carried the
  // answer past the page's cap and the page refused it whole.
  it("stays under the page's cap when the screen draws thousands of cards the record does not, still naming it", () => {
    const rows = Array.from({ length: 2000 }, (_, at) => row({ key: `ask:acme-gone-${String(at)}` }));
    const screen = {
      cards: screenCards({ rows }),
      drawn: rows.map(({ key }) => key),
      kind: "seen",
      shown: SHOWN,
    } as const;
    const answer = answerOver({ screen });
    expect(toolOutputOf({ answer, tool: "action_items" })).toBe(JSON.stringify(answer));
    expect(new TextEncoder().encode(JSON.stringify({ unread: answer.unread })).length).toBeLessThanOrEqual(
      UNREAD_MAX_BYTES,
    );
    expect(answer.unread.at(-1)!.source).toBe(SCREEN_QUEUE_SOURCE);
    expect(answer.unread.at(-1)!.why).toContain("the screen still draws ask:acme-gone-0");
  });

  it("names the screen unread when it did not reach the voice, the items still the record's", () => {
    const answer = answerOver({ screen: { kind: "unreached", why: "deadline" } });
    expect(answer.unread.at(-1)).toEqual({
      source: SCREEN_QUEUE_SOURCE,
      why: "the Queue on screen did not reach the voice, so its counts and order are unread: deadline",
    });
    expect(Object.values(answer.shown).every((count) => count === "unread")).toBe(true);
  });
});

describe("cardOnlyUnreadOf", () => {
  it("names the autonomy acts unread while they load, or with why their read failed", () => {
    expect(cardOnlyUnreadOf({ acts: { phase: "loading" } })).toEqual([
      { source: "autonomy acts", why: "still loading" },
    ]);
    expect(cardOnlyUnreadOf({ acts: { phase: "not-measured", why: "ledger read timed out" } })).toEqual([
      { source: "autonomy acts", why: "ledger read timed out" },
    ]);
  });

  it("remembers a source unread at any card read, once, as other calls replace the record between them", () => {
    const acts = { source: "autonomy acts", why: "still loading" };
    const board = { source: "board", why: "timed out" };
    const records = [[acts], [board, acts], [], []];
    let at = 0;
    const reads = trackedCardReads({
      cards: () => {
        const unread = records[at];
        at += 1;
        return { unread };
      },
    });
    // Each read carries what every read before it could not read, so a refusal worded from the latest names it all.
    expect([reads.cards().unread, reads.cards().unread, reads.cards().unread]).toEqual([
      [acts],
      [acts, board],
      [acts, board],
    ]);
    expect(reads.unreadSeen()).toEqual([acts, board]);
  });

  it("names every source a tool's reads could not read beside a card it found, and nothing when all arrived", () => {
    const board = { source: "board", why: "timed out" };
    const found = { answer: { key: "ask:acme" }, refused: false };
    expect(withCardsUnread({ capBytes: TOOL_OUTPUT_MAX, ran: found, unreadSeen: () => [board] })).toEqual({
      answer: { key: "ask:acme", unread: [board] },
      refused: false,
    });
    expect(withCardsUnread({ capBytes: TOOL_OUTPUT_MAX, ran: found, unreadSeen: () => [] })).toEqual(found);
  });

  // Every refusal that read cards names its unread sources itself (`cardToolSettledUnread.test.ts`); a blank key read none.
  it("leaves a refusal as it is, and never reads the cards for one", () => {
    const refusal = { answer: { refused: "ask:acme is not among what has loaded" }, refused: true };
    const asked: string[] = [];
    const unreadSeen = () => {
      asked.push("read");
      return [{ source: "board", why: "timed out" }];
    };
    expect(withCardsUnread({ capBytes: TOOL_OUTPUT_MAX, ran: refusal, unreadSeen })).toEqual(refusal);
    expect(asked).toEqual([]);
  });

  it("holds a failed ledger read's 30 KiB reason to the unread budget, still naming the acts", () => {
    const unread = cardOnlyUnreadOf({ acts: { phase: "not-measured", why: "e".repeat(30 * 1024) } });
    expect(unread.map((one) => one.source)).toEqual(["autonomy acts"]);
    expect(Buffer.byteLength(JSON.stringify(unread))).toBeLessThanOrEqual(UNREAD_MAX_BYTES);
  });

  it("names nothing once the acts arrived", () => {
    expect(cardOnlyUnreadOf({ acts: ready({ at: "2026-11-08T06:00:00.000Z", value: [] }) })).toEqual([]);
  });
});
