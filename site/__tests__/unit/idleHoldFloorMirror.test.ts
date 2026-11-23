/*
 * The machine chart and the capacity verb agree on the idle percentage a load hold clears at.
 *
 * `site/lib/machineSeries.ts` restates `src/live/machine/capacityHolds.ts`'s `IDLE_HOLD_FLOOR_PCT` because `site/`
 * never imports `src/`; this file, in the lane that reaches both roots, is what binds the copy — a floor changed in
 * one alone would let the page mark a hold the verb never held, or the reverse.
 */

import { describe, expect, it } from "vitest";

import { cpuLoadHolding, IDLE_HOLD_FLOOR_PCT as VERB_FLOOR } from "../../../src/live/machine/cpuLoadHold";
import { IDLE_HOLD_FLOOR_PCT as SITE_FLOOR, sampleHeld } from "../../lib/machineSeries";

/** A sample over its hold of 45, at this idle percentage, in the site's shape. */
const siteHeld = ({ idlePct }: { idlePct: number }): boolean =>
  sampleHeld({
    sample: {
      cores: 15,
      cpu: { fleetPct: 300, idlePct, otherPct: 200 },
      load: { holdAt: 45, load1: 50 },
      memory: { compressorSegmentsPct: 15, swapTotalGb: 3, swapUsedGb: 1, totalBytes: 48, usedBytes: 40 },
      observedAtIso: "2026-10-19T00:00:00.000Z",
      sessions: [],
      topOtherCpu: [],
      topOtherMemory: [],
    },
  });

describe("the site's idle floor and the verb's agree", () => {
  it("on the number", () => {
    expect(SITE_FLOOR).toBe(VERB_FLOOR);
  });

  it("on whether a load over its hold holds, at and either side of the floor", () => {
    const idles = [VERB_FLOOR - 0.1, VERB_FLOOR, VERB_FLOOR + 0.1, 0, 100];
    expect(idles.map((idlePct) => siteHeld({ idlePct }))).toEqual(
      idles.map((idlePct) => cpuLoadHolding({ idlePct, load1: 50, loadHold: 45 })),
    );
    expect(idles.map((idlePct) => siteHeld({ idlePct }))).toEqual([true, false, false, true, false]);
  });
});
