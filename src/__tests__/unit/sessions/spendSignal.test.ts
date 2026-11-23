/** {@link spendVerdict} — the trend, which drains post, and which keys a reading carries forward. */
import { describe, expect, it } from "vitest";

import { measured, unmeasurable } from "../../../measurement/status.js";
import type { Drain } from "../../../sessions/spendDrains.js";
import { zeroRefusals } from "../../../sessions/spendFold.js";
import type { SpendReport } from "../../../sessions/spendReport.js";
import {
  baselineOf,
  hasSomethingToShow,
  postedKeys,
  type SpendBaseline,
  spendVerdict,
} from "../../../sessions/spendSignal.js";

/** A drain at `share` of the draw. */
function drain({ key, share }: { key: string; share: number }): Drain {
  return { fix: "a ruling", key, savingUnits: share * 1_000, share, what: key };
}

/** A report with the given landing cost and drains. */
function report({
  unitsPerLanding,
  drains,
}: {
  unitsPerLanding: number | undefined;
  drains: readonly Drain[];
}): SpendReport {
  return {
    byDay: [],
    byFamily: [],
    bySeat: [],
    days: ["2026-09-27"],
    defaultFamily: "opus-5.5",
    drains,
    landingCost:
      unitsPerLanding === undefined
        ? unmeasurable({ why: "nothing landed" })
        : measured({ value: { landed: 1, units: unitsPerLanding, unitsPerLanding } }),
    observedAtIso: "2026-10-05T05:30:00.000Z",
    rateCard: { asOf: "2026-09-24", id: "card" },
    refusals: zeroRefusals(),
    repos: [],
    transcripts: 1,
    turns: 1,
    units: 1_000,
    unreadable: 0,
  };
}

/** A baseline at `unitsPerLanding`, having posted `posted`. */
function baseline({
  unitsPerLanding,
  posted = [],
  shares = [],
}: {
  unitsPerLanding: number | undefined;
  posted?: readonly string[];
  shares?: readonly (readonly [string, number])[];
}): SpendBaseline {
  return { drainShares: new Map(shares), observedAtIso: "2026-09-28T05:30:00.000Z", posted, unitsPerLanding };
}

describe("spendVerdict trend", () => {
  it("is a win at 20% cheaper per landed change, a drain at 20% dearer, steady between", () => {
    expect(
      spendVerdict({
        baseline: baseline({ unitsPerLanding: 100 }),
        current: report({ drains: [], unitsPerLanding: 80 }),
      }).trend,
    ).toBe("win");
    expect(
      spendVerdict({
        baseline: baseline({ unitsPerLanding: 100 }),
        current: report({ drains: [], unitsPerLanding: 120 }),
      }).trend,
    ).toBe("drain");
    expect(
      spendVerdict({
        baseline: baseline({ unitsPerLanding: 100 }),
        current: report({ drains: [], unitsPerLanding: 85 }),
      }).trend,
    ).toBe("steady");
  });

  it("is unmeasurable with no baseline, and says this reading is the baseline", () => {
    const signal = spendVerdict({ baseline: undefined, current: report({ drains: [], unitsPerLanding: 80 }) });
    expect(signal.trend).toBe("unmeasurable");
    expect(signal.because).toBe("no earlier reading carries units per landed change — this one is the baseline");
    expect(hasSomethingToShow({ signal })).toBe(false);
  });
});

describe("spendVerdict drains", () => {
  const current = report({
    drains: [drain({ key: "model:non-chair:fable-5.1", share: 0.05 }), drain({ key: "refusals", share: 0.01 })],
    unitsPerLanding: 95,
  });

  it("posts a drain worth the line on the first pass, never one below it", () => {
    const signal = spendVerdict({ baseline: undefined, current });
    expect(signal.post.map((entry) => entry.key)).toEqual(["model:non-chair:fable-5.1"]);
    expect(hasSomethingToShow({ signal })).toBe(true);
    expect(postedKeys({ registered: true, signal })).toEqual(["model:non-chair:fable-5.1"]);
    expect(postedKeys({ registered: false, signal })).toEqual([]);
  });

  it("does not repost a drain already posted unless its share grew by half", () => {
    const held = spendVerdict({
      baseline: baseline({
        posted: ["model:non-chair:fable-5.1"],
        shares: [["model:non-chair:fable-5.1", 0.04]],
        unitsPerLanding: 100,
      }),
      current,
    });
    expect(held.post).toEqual([]);
    expect(held.carried).toEqual(["model:non-chair:fable-5.1"]);
    expect(hasSomethingToShow({ signal: held })).toBe(false);
    expect(postedKeys({ registered: false, signal: held })).toEqual(["model:non-chair:fable-5.1"]);
    const grown = spendVerdict({
      baseline: baseline({
        posted: ["model:non-chair:fable-5.1"],
        shares: [["model:non-chair:fable-5.1", 0.03]],
        unitsPerLanding: 100,
      }),
      current,
    });
    expect(grown.post.map((entry) => entry.key)).toEqual(["model:non-chair:fable-5.1"]);
  });
});

describe("baselineOf", () => {
  it("reads units per landed change, drain shares and posted keys back from a stored document", () => {
    const read = baselineOf({
      document: {
        drains: [{ key: "refusals", share: 0.01 }],
        landingCost: { known: true, value: { landed: 2, units: 10, unitsPerLanding: 5 } },
        observedAtIso: "2026-09-28T05:30:00.000Z",
        posted: ["refusals"],
      },
    });
    expect(read).toEqual(
      measured({
        value: {
          drainShares: new Map([["refusals", 0.01]]),
          observedAtIso: "2026-09-28T05:30:00.000Z",
          posted: ["refusals"],
          unitsPerLanding: 5,
        },
      }),
    );
  });

  it("refuses a document that is not a spend reading", () => {
    expect(baselineOf({ document: { verdict: "held" } })).toEqual(
      unmeasurable({ why: "the stored reading carries no observedAtIso, drains or posted keys" }),
    );
  });
});
