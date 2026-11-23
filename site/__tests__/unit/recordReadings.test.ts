/*
 * A fresh record read's failed registers reach every Queue answer: the `talk steers` reading a
 * steer held on this call is judged against, and the workstream priorities the Queue is ordered by. Both used to be
 * read and then dropped, so a card hidden on an unread reading, or an order given without its priorities, was said
 * as complete.
 */
import { describe, expect, it } from "vitest";

import { voiceRecordOf } from "../../components/voice/freshVoiceRecord";
import { HELD_STEERS_SOURCE, heldSteersUnreadOf, recordReadingsOf } from "../../components/voice/recordReadings";
import { queueScopeOf, queueShownCounts } from "../../lib/queueShownCounts";
import type { LocalSteer } from "../../lib/steeredCards";
import { actionItemsAnswer } from "../../lib/talkActionItems";
import { ACME_PLACER } from "../organisationFixture";

const HELD: LocalSteer = {
  cardKey: "ask:acme-1",
  detail: "",
  heard: "park that one",
  outcome: "relayed",
  sentAtIso: "2026-11-09T00:00:00.000Z",
  turnId: "turn-acme",
};

const DOWN = { phase: "not-measured", why: "talk steers did not answer within the 15 s" } as const;

describe("heldSteersUnreadOf", () => {
  it("names the reading unread when a held steer was judged against it and it did not arrive", () => {
    expect(heldSteersUnreadOf({ held: [HELD], reading: DOWN })).toEqual({ source: HELD_STEERS_SOURCE, why: DOWN.why });
    expect(heldSteersUnreadOf({ held: [HELD], reading: { phase: "loading" } })).toEqual({
      source: HELD_STEERS_SOURCE,
      why: "still loading",
    });
  });

  it("names nothing when nothing is held, since the reading then decides nothing", () => {
    expect(heldSteersUnreadOf({ held: [], reading: DOWN })).toBe(undefined);
  });
});

describe("a fresh record whose registers failed, through action_items", () => {
  const record = voiceRecordOf({
    arrival: { kind: "failed", why: "the voice record read did not answer within 20 s" },
  });

  /**
   * The answer over the record, with what this browser holds.
   *
   * @param held the steers held on this call
   * @returns the sources the answer names unread, by name
   */
  function unreadOver({ held }: { held: readonly LocalSteer[] }): readonly string[] {
    return actionItemsAnswer({
      ...recordReadingsOf({ heldSteers: held, record }),
      context: "everything",
      nowIso: "2026-11-09T00:01:00.000Z",
      placer: ACME_PLACER,
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
    }).unread.map((one) => one.source);
  }

  it("names the workstream priorities and the held steer's reading among what it could not read", () => {
    const names = unreadOver({ held: [HELD] });
    expect(names.filter((name) => name === "your workstream priorities" || name === HELD_STEERS_SOURCE)).toEqual([
      "your workstream priorities",
      HELD_STEERS_SOURCE,
    ]);
  });

  it("leaves the steers' reading unnamed with nothing held, and still names the priorities", () => {
    const names = unreadOver({ held: [] });
    expect([names.includes(HELD_STEERS_SOURCE), names.includes("your workstream priorities")]).toEqual([false, true]);
  });
});
