import { describe, expect, it } from "vitest";
import type { Item } from "../../../sessionStart/item.js";
import type { DroppedItem, RankedItem, RankInput, SignalReadings } from "../../../sessionStart/rank.js";
import { contribution, contributions, rankAll, rankOne, rankWhy, SIGNAL_CAPS } from "../../../sessionStart/rank.js";
import { applyRuleZero } from "../../../silver/ruleZero.js";
import { traceBeforeRanking } from "../../../silver/traceBeforeRanking.js";

const NOW = "2026-08-30T00:00:00.000Z";

/** Every signal at zero, which each case raises one at a time. */
const NO_READINGS: SignalReadings = {
  age: 0,
  directness: 0,
  distanceToDone: 0,
  drift: 0,
  explicitPriority: 0,
  stoppedOnOwner: 0,
};

/** An item that passes both gates, so a case can vary one thing. */
const item = ({ nativeId }: { nativeId: string }): Item => ({
  background: "what this thing is, for a reader holding no context",
  doneWhen: "reply to the review comment, then ask for the overall review",
  nativeId,
  source: "github",
  whenIso: "2026-08-29T00:00:00.000Z",
  where: `https://github.com/acme/app/pull/${nativeId}`,
  who: "a-teammate",
});

/** Rule zero's own-move verdict, the ordinary case. */
const HIS_MOVE = applyRuleZero({ lastMovedIso: "2026-08-29T00:00:00.000Z", move: { party: "owner" }, nowIso: NOW });

/** A trace that found the item still open where it came from. */
const STILL_OPEN = traceBeforeRanking({
  evidence: [
    {
      grade: "provider-fact",
      showsResolved: false,
      source: "github:acme/app#16341",
      what: "still open",
    },
  ],
});

const input = ({
  nativeId,
  readings,
  finishesInFlight = false,
  unverified = false,
}: {
  nativeId: string;
  readings: SignalReadings;
  finishesInFlight?: boolean;
  unverified?: boolean;
}): RankInput => ({
  finishesInFlight,
  item: item({ nativeId }),
  readings,
  ruleZero: HIS_MOVE,
  trace: STILL_OPEN,
  unverified,
});

/** The ranked row, or a throw — keeps `&&` out of every assertion below, per the testing rules. */
const mustRank = ({ result }: { result: RankedItem | DroppedItem }): RankedItem => {
  if ("reason" in result) {
    throw new Error(`expected a ranked row, got a drop: ${result.reason}`);
  }
  return result;
};

/** The drop, or a throw. Same reason as {@link mustRank}. */
const mustDrop = ({ result }: { result: RankedItem | DroppedItem }): DroppedItem => {
  if (!("reason" in result)) {
    throw new Error(`expected a drop, got a ranked row scoring ${String(result.score)}`);
  }
  return result;
};

describe("contribution", () => {
  it("passes a reading through below its cap", () => {
    expect(contribution({ name: "stoppedOnOwner", reading: 3 })).toBe(3);
  });

  it("clamps a reading to its cap", () => {
    expect(contribution({ name: "age", reading: 99 })).toBe(SIGNAL_CAPS.age);
  });

  it("contributes nothing for a negative reading rather than subtracting", () => {
    expect(contribution({ name: "drift", reading: -4 })).toBe(0);
  });

  it("contributes nothing for a non-finite reading", () => {
    expect(contribution({ name: "drift", reading: Number.NaN })).toBe(0);
  });
});

describe("contributions", () => {
  it("caps every signal independently", () => {
    const capped = contributions({
      readings: { ...NO_READINGS, drift: 100, stoppedOnOwner: 100 },
      unverified: false,
    });
    expect(capped.stoppedOnOwner).toBe(5);
    expect(capped.drift).toBe(4);
  });

  it("zeroes age for an unverified item, because a stale cursor cannot establish that it sat", () => {
    const capped = contributions({ readings: { ...NO_READINGS, age: 2 }, unverified: true });
    expect(capped.age).toBe(0);
  });

  it("leaves the other signals alone when the item is unverified", () => {
    const capped = contributions({ readings: { ...NO_READINGS, age: 2, directness: 3 }, unverified: true });
    expect(capped.directness).toBe(3);
  });
});

describe("rankWhy", () => {
  it("names the largest contributor in plain words", () => {
    const why = rankWhy({
      contributionsByName: { ...NO_READINGS, directness: 1, stoppedOnOwner: 4 },
      ruleZero: HIS_MOVE,
      unverified: false,
    });
    expect(why).toBe("somebody is stopped waiting on you");
  });

  it("leads with the chase, because the action on a chase row is different in kind", () => {
    const chase = applyRuleZero({
      lastMovedIso: "2026-08-26T00:00:00.000Z",
      move: { party: "other", who: "a-teammate" },
      nowIso: NOW,
    });
    expect(rankWhy({ contributionsByName: { ...NO_READINGS, drift: 4 }, ruleZero: chase, unverified: false })).toBe(
      "a-teammate has had this for 96h with no movement",
    );
  });

  it("says what distance-to-done measures, not what a high reading feels like", () => {
    // A project that has NEVER had a status update carries this signal at its cap, because one word posts
    // the drafted body. "It is close to finished" was false of the project and true only of the reply.
    expect(
      rankWhy({
        contributionsByName: { ...NO_READINGS, distanceToDone: 3 },
        ruleZero: HIS_MOVE,
        unverified: false,
      }),
    ).toBe("one reply finishes it");
  });

  it("says so when nothing ranked the item", () => {
    expect(rankWhy({ contributionsByName: NO_READINGS, ruleZero: HIS_MOVE, unverified: false })).toBe(
      "nothing ranked this above anything else",
    );
  });

  it("appends the unverified caveat rather than hiding it", () => {
    const why = rankWhy({
      contributionsByName: { ...NO_READINGS, drift: 4 },
      ruleZero: HIS_MOVE,
      unverified: true,
    });
    expect(why).toBe(
      "what the system says about this stopped matching what is true, and its source has not been read since",
    );
  });
});

describe("rankOne", () => {
  it("scores an item that passes both gates", () => {
    const result = rankOne({ input: input({ nativeId: "1", readings: { ...NO_READINGS, distanceToDone: 3 } }) });
    expect(mustRank({ result }).score).toBe(3);
  });

  it("drops what rule zero suppresses, and carries its reason", () => {
    const result = rankOne({
      input: {
        ...input({ nativeId: "2", readings: NO_READINGS }),
        ruleZero: applyRuleZero({
          lastMovedIso: "2026-08-29T12:00:00.000Z",
          move: { party: "other", who: "a-teammate" },
          nowIso: NOW,
        }),
      },
    });
    expect(mustDrop({ result }).reason).toBe("sitting with a-teammate for 12h");
  });

  it("drops what nobody has read, and carries the trace's reason", () => {
    const result = rankOne({
      input: { ...input({ nativeId: "3", readings: NO_READINGS }), trace: traceBeforeRanking({ evidence: [] }) },
    });
    expect(mustDrop({ result }).reason).toBe("nothing was traced back to a source the provider owns — read it live");
  });

  it("does not let a strong score outvote a gate", () => {
    const result = rankOne({
      input: {
        ...input({ nativeId: "4", readings: { ...NO_READINGS, drift: 99, stoppedOnOwner: 99 } }),
        trace: traceBeforeRanking({ evidence: [] }),
      },
    });
    expect(mustDrop({ result }).reason).toBe("nothing was traced back to a source the provider owns — read it live");
  });
});

describe("rankAll", () => {
  it("orders by score, highest first", () => {
    const ranking = rankAll({
      inputs: [
        input({ nativeId: "low", readings: { ...NO_READINGS, age: 1 } }),
        input({ nativeId: "high", readings: { ...NO_READINGS, stoppedOnOwner: 5 } }),
      ],
    });
    expect(ranking.ranked.map((row) => row.item.nativeId)).toEqual(["high", "low"]);
  });

  it("breaks a tie on the north star — finishing in-flight work wins", () => {
    const ranking = rankAll({
      inputs: [
        input({ nativeId: "shiny", readings: { ...NO_READINGS, drift: 2 } }),
        input({ finishesInFlight: true, nativeId: "in-flight", readings: { ...NO_READINGS, drift: 2 } }),
      ],
    });
    expect(ranking.ranked.map((row) => row.item.nativeId)).toEqual(["in-flight", "shiny"]);
  });

  it("breaks a remaining tie on identity, so an unchanged world ranks the same twice", () => {
    const inputs = [
      input({ nativeId: "bbb", readings: { ...NO_READINGS, drift: 2 } }),
      input({ nativeId: "aaa", readings: { ...NO_READINGS, drift: 2 } }),
    ];
    expect(rankAll({ inputs }).ranked.map((row) => row.item.nativeId)).toEqual(["aaa", "bbb"]);
    expect(rankAll({ inputs: inputs.toReversed() }).ranked.map((row) => row.item.nativeId)).toEqual(["aaa", "bbb"]);
  });

  it("reports the dropped items beside the ranked ones", () => {
    const ranking = rankAll({
      inputs: [
        input({ nativeId: "kept", readings: { ...NO_READINGS, drift: 2 } }),
        { ...input({ nativeId: "gone", readings: NO_READINGS }), trace: traceBeforeRanking({ evidence: [] }) },
      ],
    });
    expect(ranking.ranked.map((row) => row.item.nativeId)).toEqual(["kept"]);
    expect(ranking.dropped.map((row) => row.item.nativeId)).toEqual(["gone"]);
  });
});
