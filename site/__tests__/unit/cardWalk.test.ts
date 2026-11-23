/*
 * The move-on rule on the page: the walk writes a move only when `open_card` put a different card in front of the
 * owner while one this call resolved was open, and a card the walk moved on from is off their Queue until it has news
 * since — never a hand step or a staged import.
 */
import { describe, expect, it } from "vitest";

import type { CardLandings, CardMove } from "../../components/live/readCardLandings";
import type { LiveState } from "../../components/live/useLive";
import { landingVerdict, movesByCard, unlandedRows } from "../../lib/cardLandings";
import { FRESH_WALK, walkOpened, walkResolved } from "../../lib/cardWalk";
import { NO_STEERS } from "../../lib/steeredCards";

const T0 = "2026-11-02T12:35:00.000Z";
const T1 = "2026-11-02T12:37:16.000Z";

/** The walk once `read_card` resolved the ask at `T0`. */
const READ = walkResolved({ cardKey: "ask:acme-1", nowIso: T0, walk: FRESH_WALK });

/** One `open_card` from the ask, every condition met unless overridden; no other opening ran meanwhile unless named. */
const step = (over: Partial<Parameters<typeof walkOpened>[0]> = {}): ReturnType<typeof walkOpened> => {
  const args = {
    comeBack: undefined,
    from: "ask:acme-1",
    nowIso: T1,
    opened: true,
    requestId: "req-1",
    to: "ask:acme-2",
    walk: READ,
    ...over,
  };
  return walkOpened({ began: { front: args.walk.front, lastPut: args.walk.lastPut }, ...args });
};

describe("walkResolved", () => {
  it("keeps the instant the walk first reached a card, and ignores a resolution of nothing", () => {
    const again = walkResolved({ cardKey: "ask:acme-1", nowIso: T1, walk: READ });
    expect([...again.resolved]).toEqual([["ask:acme-1", T0]]);
    expect(walkResolved({ cardKey: undefined, nowIso: T1, walk: READ })).toBe(READ);
  });
});

describe("walkOpened", () => {
  it("moves on from the card it resolved to the next, and drops the card it left", () => {
    const { move, walk } = step();
    expect(move).toEqual({
      disposition: "moved-on",
      fromCardKey: "ask:acme-1",
      fromSinceIso: T0,
      requestId: "req-1",
      toCardKey: "ask:acme-2",
    });
    expect([...walk.resolved]).toEqual([["ask:acme-2", T1]]);
  });

  it("marks a come-back only on a literal true", () => {
    expect([step({ comeBack: true }).move!.disposition, step({ comeBack: "yes" }).move!.disposition]).toEqual([
      "come-back",
      "moved-on",
    ]);
  });

  it("moves nothing when the card was never resolved this call, the next did not open, or it is the same card", () => {
    const none = [
      step({ walk: FRESH_WALK }),
      step({ opened: false }),
      step({ to: "ask:acme-1" }),
      step({ from: undefined }),
      step({ to: undefined }),
    ].map((one) => one.move);
    expect(none).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("keeps the card it opened in front of the owner, and the one before when the next did not open", () => {
    expect([step().walk.front, step({ opened: false }).walk.front, step({ to: undefined }).walk.front]).toEqual([
      "ask:acme-2",
      undefined,
      undefined,
    ]);
    const shown = { ...READ, front: "ask:acme-1" };
    expect(step({ opened: false, walk: shown }).walk.front).toBe("ask:acme-1");
  });

  // The owner followed the card's linked report, so the page had no card open when the walk moved on.
  it("moves on from the card in front of the owner when the page shows none, and never past the page's own card", () => {
    const shown = { ...READ, front: "ask:acme-1" };
    expect(step({ from: undefined, walk: shown }).move).toEqual({
      disposition: "moved-on",
      fromCardKey: "ask:acme-1",
      fromSinceIso: T0,
      requestId: "req-1",
      toCardKey: "ask:acme-2",
    });
    // A card the owner opened themselves, never resolved by the walk, is the card left: nothing moves.
    expect(step({ from: "ask:owner-opened", walk: shown }).move).toBeUndefined();
    // A card in front of the owner that the walk never resolved moves nothing either.
    expect(step({ from: undefined, walk: { ...FRESH_WALK, front: "ask:acme-1" } }).move).toBeUndefined();
  });

  // Two openings in flight at once on one call, the later-begun one finishing first.
  it("never moves on from a card another opening put in front of the owner while this one was in flight", () => {
    const shown = { ...READ, front: "ask:acme-1" };
    const first = step({ from: undefined, to: "ask:acme-3", walk: shown });
    expect(first.walk.front).toBe("ask:acme-3");
    const began = { front: "ask:acme-1", lastPut: shown.lastPut };
    const late = step({ began, from: undefined, to: "ask:acme-2", walk: first.walk });
    expect([late.move, late.walk.front, [...late.walk.resolved.keys()]]).toEqual([
      undefined,
      undefined,
      ["ask:acme-3", "ask:acme-2"],
    ]);
  });

  // Three overlapping openings cycle the front from A to B and back to A.
  it("never moves on when the front came back to the card it began with under another opening", () => {
    const shown = { ...READ, front: "ask:acme-1" };
    const began = { front: "ask:acme-1", lastPut: shown.lastPut };
    const toB = step({ from: undefined, to: "ask:acme-2", walk: shown });
    const backToA = step({ from: undefined, to: "ask:acme-1", walk: toB.walk });
    expect([backToA.move!.fromCardKey, backToA.walk.front]).toEqual(["ask:acme-2", "ask:acme-1"]);
    const oldest = step({ began, from: undefined, to: "ask:acme-3", walk: backToA.walk });
    expect([oldest.move, oldest.walk.front, oldest.walk.lastPut === backToA.walk.lastPut]).toEqual([
      undefined,
      undefined,
      false,
    ]);
  });

  // The page's own card, read as the opening began, may be the card another opening re-opened.
  it("moves nothing from the page's card once an overlapping opening put one in front; a refused one is no overlap", () => {
    const shown = { ...READ, front: "ask:acme-1" };
    const began = { front: "ask:acme-1", lastPut: shown.lastPut };
    const reopened = step({ to: "ask:acme-1", walk: shown });
    const slow = step({ began, walk: reopened.walk });
    const refused = step({ opened: false, walk: shown });
    const after = step({ began, walk: refused.walk });
    const refusedKeptToken = refused.walk.lastPut === shown.lastPut;
    expect([reopened.move, slow.move, slow.walk.front, refusedKeptToken, after.move!.fromCardKey]).toEqual([
      undefined,
      undefined,
      undefined,
      true,
      "ask:acme-1",
    ]);
  });

  it("writes no line talk transcript would refuse: a malformed key, a bare pr:<number> or a request id out of bounds", () => {
    const loose = walkResolved({ cardKey: "not a key", nowIso: T0, walk: FRESH_WALK });
    const bare = walkResolved({ cardKey: "pr:42", nowIso: T0, walk: FRESH_WALK });
    const none = [
      step({ from: "not a key", walk: loose }),
      step({ from: "pr:42", walk: bare }),
      step({ requestId: "" }),
      step({ requestId: "r".repeat(201) }),
    ].map((one) => one.move);
    expect(none).toEqual([undefined, undefined, undefined, undefined]);
    expect(step({ requestId: "r".repeat(200) }).move!.requestId).toHaveLength(200);
  });
});

const MOVE: CardMove = {
  anchor: "call:c-1#move:req-1",
  atIso: "2026-11-02T12:38:00.000Z",
  cardKey: "ask:acme-1",
  decidedIso: T1,
  toCardKey: "ask:acme-2",
};

/** The `talk cards` reading carrying these moves and no landing. */
const spokenOf = ({ moves }: { moves: readonly CardMove[] }): LiveState<CardLandings> => ({
  fixture: undefined,
  observedAtIso: "2026-11-02T12:39:00.000Z",
  phase: "ready",
  stampedByRoute: false,
  value: { landings: [], moves, triageUnreadable: 0, unreadable: 0, unreadableLines: [] },
});

describe("a card the walk moved on from", () => {
  const verdictOf = ({
    row,
    moves,
  }: {
    row: { key: string; landingFloorIso?: string; currencyFloorIso?: string };
    moves: readonly CardMove[];
  }) => landingVerdict({ inFlight: new Set(), landings: undefined, moves, row, steers: NO_STEERS });

  // A pull request row dates its news by `currencyFloorIso` (its `updatedAtIso`) alone.
  it("comes back on a pull request's news since the move, but never on an ask's re-confirm", () => {
    const pr = { ...MOVE, cardKey: "pr:123" };
    expect([
      verdictOf({ moves: [pr], row: { currencyFloorIso: "2026-11-02T12:40:00.000Z", key: "pr:123" } }),
      verdictOf({ moves: [pr], row: { currencyFloorIso: "2026-11-02T12:30:00.000Z", key: "pr:123" } }),
      verdictOf({ moves: [MOVE], row: { currencyFloorIso: "2026-11-02T12:40:00.000Z", key: "ask:acme-1" } }),
    ]).toEqual([{ kind: "shown" }, { kind: "hidden" }, { kind: "hidden" }]);
  });

  it("is hidden, unless it has news since the move, or is a hand step or a staged import", () => {
    expect([
      verdictOf({ moves: [MOVE], row: { key: "ask:acme-1" } }),
      verdictOf({ moves: [MOVE], row: { key: "ask:acme-1", landingFloorIso: "2026-11-02T12:37:00.000Z" } }),
      verdictOf({ moves: [MOVE], row: { key: "ask:acme-1", landingFloorIso: "2026-11-02T12:40:00.000Z" } }),
      verdictOf({ moves: [{ ...MOVE, cardKey: "hand:h-1" }], row: { key: "hand:h-1" } }),
      verdictOf({ moves: [{ ...MOVE, cardKey: "import:q-1" }], row: { key: "import:q-1" } }),
    ]).toEqual([{ kind: "hidden" }, { kind: "hidden" }, { kind: "shown" }, { kind: "shown" }, { kind: "shown" }]);
  });

  it("is left off the voice's list, and every other card stays on it", () => {
    const rows = [{ key: "ask:acme-1" }, { key: "ask:acme-2" }];
    const spoken = spokenOf({ moves: [MOVE] });
    expect([...movesByCard({ spoken }).keys()]).toEqual(["ask:acme-1"]);
    expect(unlandedRows({ rows, spoken, steers: NO_STEERS }).map((row) => row.key)).toEqual(["ask:acme-2"]);
    expect(unlandedRows({ rows, spoken: spokenOf({ moves: [] }), steers: NO_STEERS })).toBe(rows);
  });
});
