/**
 * A provider's trailing weekly draw off the filed capacity readings: high-water marked inside one window, a new window
 * counted whole, an unaccountable window never counted, and a series too short to give a rate refused.
 */
import { describe, expect, it } from "vitest";

import type { Ceiling } from "../../../capacity/ceilings.js";
import { type DemandPoint, MIN_DEMAND_SPAN_HOURS, trailingWeekDemand } from "../../../capacity/weekDemand.js";

const START_MS = Date.parse("2026-11-01T00:00:00.000Z");
const HOUR_MS = 3_600_000;

/** An instant `hours` after the series starts. */
function at({ hours }: { hours: number }): string {
  return new Date(START_MS + hours * HOUR_MS).toISOString();
}

/** A Codex plan's ceiling with its weekly window at `used`, resetting `resetHours` after the series starts. */
function codex({ alias, resetHours, used }: { alias: string; resetHours: number; used: number }): Ceiling {
  return {
    account: null,
    freeResets: 2,
    headroom: null,
    id: `codex:${alias}`,
    kind: "codex",
    reason: null,
    status: "open",
    windows: [{ available: 100, resetAtIso: at({ hours: resetHours }), used, window: "weekly" }],
  };
}

/** One filed reading. */
function point({ ceilings, hours }: { ceilings: readonly Ceiling[]; hours: number }): DemandPoint {
  return { ceilings, observedAtIso: at({ hours }) };
}

/** The measured rate, throwing when the series could not give one so the assertion carries no branch. */
function rateOf({ points }: { points: readonly DemandPoint[] }): number {
  const demand = trailingWeekDemand({ kind: "codex", points, window: "weekly" });
  if (demand.kind !== "measured") {
    throw new Error(`expected a rate, got: ${demand.why}`);
  }
  return demand.pointsPerHour;
}

describe("trailingWeekDemand", () => {
  it("sums each plan's rise across the span", () => {
    const points = [
      point({
        ceilings: [codex({ alias: "a", resetHours: 100, used: 10 }), codex({ alias: "b", resetHours: 90, used: 0 })],
        hours: 0,
      }),
      point({
        ceilings: [codex({ alias: "a", resetHours: 100, used: 30 }), codex({ alias: "b", resetHours: 90, used: 18 })],
        hours: 24,
      }),
    ];
    expect(rateOf({ points })).toBeCloseTo(38 / 24, 12);
  });

  it("counts a dip and recovery inside one window once, against its high-water mark", () => {
    const points = [0, 8, 16, 24].map((hours, index) =>
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: [10, 20, 15, 22][index]! })], hours }),
    );
    expect(rateOf({ points })).toBeCloseTo(12 / 24, 12);
  });

  it("counts the whole of a new window opened inside the interval — a natural reset or a free reset claim", () => {
    const claimed = [
      point({ ceilings: [codex({ alias: "a", resetHours: 30, used: 99 })], hours: 0 }),
      // Claimed at hour 12: the week restarts at 0 and resets seven days from the claim; 6 points drawn since.
      point({ ceilings: [codex({ alias: "a", resetHours: 12 + 168, used: 6 })], hours: 24 }),
    ];
    expect(rateOf({ points: claimed })).toBeCloseTo(6 / 24, 12);
  });

  it("restarts the baseline with no draw on a window the series cannot account for", () => {
    const backward = [
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 40 })], hours: 0 }),
      point({ ceilings: [codex({ alias: "a", resetHours: 50, used: 70 })], hours: 12 }),
      point({ ceilings: [codex({ alias: "a", resetHours: 50, used: 75 })], hours: 24 }),
    ];
    expect(rateOf({ points: backward })).toBeCloseTo(5 / 24, 12);
  });

  it("carries a plan's baseline across a reading that did not measure it", () => {
    const gap = [
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 10 })], hours: 0 }),
      point({ ceilings: [{ ...codex({ alias: "a", resetHours: 100, used: 0 }), status: "unreadable" }], hours: 12 }),
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 34 })], hours: 24 }),
    ];
    expect(rateOf({ points: gap })).toBeCloseTo(24 / 24, 12);
  });

  it("counts neither a draw nor any span from a window with no reset, or a weekly label two windows share", () => {
    const measured = codex({ alias: "a", resetHours: 100, used: 40 });
    const window = measured.windows[0]!;
    const unmeasured: readonly Ceiling[] = [
      { ...measured, windows: [{ ...window, resetAtIso: null }] },
      { ...measured, windows: [window, { ...window, resetAtIso: null }] },
    ];
    expect(unmeasured.length).toBeGreaterThan(0);
    for (const ceiling of unmeasured) {
      const points = [
        point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 10 })], hours: 0 }),
        point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 10 })], hours: 12 }),
        point({ ceilings: [ceiling], hours: 24 }),
      ];
      expect(trailingWeekDemand({ kind: "codex", points, window: "weekly" })).toEqual({
        kind: "unmeasurable",
        why: `the filed readings span 12.0h, under the ${String(MIN_DEMAND_SPAN_HOURS)}h a trailing rate needs`,
      });
    }
  });

  it("reads only the asked provider's ceilings", () => {
    const claude: Ceiling = { ...codex({ alias: "c", resetHours: 100, used: 0 }), id: "claude:c", kind: "claude" };
    const points = [
      point({ ceilings: [claude, codex({ alias: "a", resetHours: 100, used: 0 })], hours: 0 }),
      point({
        ceilings: [
          { ...claude, windows: [{ ...claude.windows[0]!, used: 90 }] },
          codex({ alias: "a", resetHours: 100, used: 12 }),
        ],
        hours: 24,
      }),
    ];
    expect(rateOf({ points })).toBeCloseTo(12 / 24, 12);
  });

  it("refuses a series shorter than a full day, and one that measured no plan", () => {
    const short = [
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 0 })], hours: 0 }),
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 10 })], hours: 6 }),
    ];
    expect(trailingWeekDemand({ kind: "codex", points: short, window: "weekly" })).toEqual({
      kind: "unmeasurable",
      why: `the filed readings span 6.0h, under the ${String(MIN_DEMAND_SPAN_HOURS)}h a trailing rate needs`,
    });
    // A Claude-only reading 12h earlier says nothing of Codex, so it never stretches Codex's 12h to a day.
    const claudeOnly: Ceiling = { ...codex({ alias: "c", resetHours: 100, used: 0 }), id: "claude:c", kind: "claude" };
    const stretched = [
      point({ ceilings: [claudeOnly], hours: 0 }),
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 0 })], hours: 12 }),
      point({ ceilings: [codex({ alias: "a", resetHours: 100, used: 0 })], hours: 24 }),
    ];
    expect(trailingWeekDemand({ kind: "codex", points: stretched, window: "weekly" })).toEqual({
      kind: "unmeasurable",
      why: `the filed readings span 12.0h, under the ${String(MIN_DEMAND_SPAN_HOURS)}h a trailing rate needs`,
    });
    expect(trailingWeekDemand({ kind: "codex", points: [], window: "weekly" })).toEqual({
      kind: "unmeasurable",
      why: "no filed reading measured a codex plan's weekly window",
    });
  });
});
