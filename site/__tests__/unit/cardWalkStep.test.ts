/*
 * One opening's step of the Queue walk, shared by `open_card` and `triage_next`: asking for the next card means
 * the current card goes back. A plain fake seam, never a mock.
 */
import { describe, expect, it } from "vitest";

import { stepCardWalk, walkBefore } from "../../components/voice/cardWalkStep";
import type { CardWalkSeam } from "../../components/voice/talkToolRunTypes";
import { type CardWalk, type CardWalkMoveFields, FRESH_WALK, walkResolved } from "../../lib/cardWalk";

const T0 = "2026-11-04T02:07:46.000Z";
const T1 = "2026-11-04T02:50:36.000Z";

/** A walk seam over plain state: the page's open card, the stamp, and what was written and recorded. */
function fakeWalk({ open, walk, stamps }: { open: string | undefined; walk: CardWalk; stamps: readonly string[] }): {
  seam: CardWalkSeam;
  moves: CardWalkMoveFields[];
  held: () => CardWalk;
} {
  let state = walk;
  let reads = 0;
  const moves: CardWalkMoveFields[] = [];
  const seam: CardWalkSeam = {
    openKeyNow: () => open,
    read: () => state,
    record: ({ move }) => {
      moves.push(move);
    },
    stamp: () => {
      const stamp = stamps[Math.min(reads, stamps.length - 1)];
      reads += 1;
      return stamp;
    },
    write: ({ walk: next }) => {
      state = next;
    },
  };
  return { held: () => state, moves, seam };
}

/** The walk once the voice put the final-cut card in front of the owner. */
const SHOWN: CardWalk = {
  ...walkResolved({ cardKey: "ask:final-cut", nowIso: T0, walk: FRESH_WALK }),
  front: "ask:final-cut",
};

describe("stepCardWalk", () => {
  it("records the move from the card in front of the owner to the next one a triage pass opened, with no card open", () => {
    const fake = fakeWalk({ open: undefined, stamps: ["0:call-a"], walk: SHOWN });
    const before = walkBefore({ walk: fake.seam });
    const ran = { walk: { cardKey: "ask:onboarding", opened: true } };
    stepCardWalk({ before, comeBack: undefined, nowIso: T1, ran, requestId: "req-1", walk: fake.seam });
    expect(fake.moves).toEqual([
      {
        disposition: "moved-on",
        fromCardKey: "ask:final-cut",
        fromSinceIso: T0,
        requestId: "req-1",
        toCardKey: "ask:onboarding",
      },
    ]);
    expect(fake.held().front).toBe("ask:onboarding");
  });

  it("moves nothing when the next card did not open, or the pass was done with no card at all", () => {
    const shut = fakeWalk({ open: undefined, stamps: ["0:call-a"], walk: SHOWN });
    const ran = { walk: { cardKey: "ask:onboarding", opened: false } };
    stepCardWalk({
      before: walkBefore({ walk: shut.seam }),
      comeBack: undefined,
      nowIso: T1,
      ran,
      requestId: "r",
      walk: shut.seam,
    });
    const done = fakeWalk({ open: undefined, stamps: ["0:call-a"], walk: SHOWN });
    stepCardWalk({
      before: walkBefore({ walk: done.seam }),
      comeBack: undefined,
      nowIso: T1,
      ran: {},
      requestId: "r",
      walk: done.seam,
    });
    expect([shut.moves, done.moves, shut.held().front, done.held().front]).toEqual([
      [],
      [],
      "ask:final-cut",
      "ask:final-cut",
    ]);
  });

  it("steps nothing when a fresh call began while the opening was in flight", () => {
    const fake = fakeWalk({ open: undefined, stamps: ["0:call-a", "1:call-b"], walk: SHOWN });
    const before = walkBefore({ walk: fake.seam });
    const ran = { walk: { cardKey: "ask:onboarding", opened: true } };
    stepCardWalk({ before, comeBack: undefined, nowIso: T1, ran, requestId: "req-1", walk: fake.seam });
    expect([fake.moves, fake.held()]).toEqual([[], SHOWN]);
  });

  // The voice starts a tool call without waiting for the last, so two can finish out of order.
  it("moves on once when two openings on one call overlap, and never from the card the other one opened", () => {
    const fake = fakeWalk({ open: undefined, stamps: ["0:call-a"], walk: SHOWN });
    const slow = walkBefore({ walk: fake.seam });
    const quick = walkBefore({ walk: fake.seam });
    const opened = ({ cardKey }: { cardKey: string }) => ({ walk: { cardKey, opened: true } });
    const ranC = opened({ cardKey: "ask:c" });
    stepCardWalk({ before: quick, comeBack: undefined, nowIso: T1, ran: ranC, requestId: "c", walk: fake.seam });
    const ranB = opened({ cardKey: "ask:b" });
    stepCardWalk({ before: slow, comeBack: undefined, nowIso: T1, ran: ranB, requestId: "b", walk: fake.seam });
    expect([fake.moves.map((move) => `${move.fromCardKey}>${move.toCardKey}`), fake.held().front]).toEqual([
      ["ask:final-cut>ask:c"],
      undefined,
    ]);
  });

  it("moves nothing for the oldest of three overlapping openings once the others cycled the front back", () => {
    const fake = fakeWalk({ open: undefined, stamps: ["0:call-a"], walk: SHOWN });
    const opened = ({ cardKey }: { cardKey: string }) => ({ walk: { cardKey, opened: true } });
    const oldest = walkBefore({ walk: fake.seam });
    const toB = walkBefore({ walk: fake.seam });
    stepCardWalk({
      before: toB,
      comeBack: undefined,
      nowIso: T1,
      ran: opened({ cardKey: "ask:b" }),
      requestId: "b",
      walk: fake.seam,
    });
    const backToA = walkBefore({ walk: fake.seam });
    const ranA = opened({ cardKey: "ask:final-cut" });
    stepCardWalk({ before: backToA, comeBack: undefined, nowIso: T1, ran: ranA, requestId: "a", walk: fake.seam });
    const ranC = opened({ cardKey: "ask:c" });
    stepCardWalk({ before: oldest, comeBack: undefined, nowIso: T1, ran: ranC, requestId: "c", walk: fake.seam });
    expect([fake.moves.map((move) => `${move.fromCardKey}>${move.toCardKey}`), fake.held().front]).toEqual([
      ["ask:final-cut>ask:b", "ask:b>ask:final-cut"],
      undefined,
    ]);
  });
});
