/**
 * `./seatBurn.ts` — pure. The burn's floating-point edges and the tick reader's span cut, each on a fixture
 * small enough to check on paper; the integrated figures are the `seatCeiling/` tests'.
 */
import { describe, expect, it } from "vitest";
import { burnOf, seatIntervalsOf, timedTicksOf, weeklySamplesOf } from "../../../capacity/seatBurn.js";
import type { DrawdownSample } from "../../../claude/drawdownAnomaly.js";

const FROM = "2026-10-04T00:00:00.000Z";
const TO = "2026-10-04T00:10:00.000Z";
const RESET = "2026-10-04T10:10:00.000Z";

/** One seven-day sample for plan `alpha`. */
function sample({ observedAtIso, utilization }: { observedAtIso: string; utilization: number }): DrawdownSample {
  return {
    kind: "sample",
    observedAtIso,
    planAlias: "alpha",
    resetAtIso: RESET,
    schemaVersion: 1,
    utilization,
    window: "seven-day",
  };
}

/** The burn over the ten-minute span for one plan reading `0` then `to`, with 20 seats working throughout. */
function burnRisingTo({ to }: { to: number }): ReturnType<typeof burnOf> {
  const fromMs = Date.parse(FROM);
  const toMs = Date.parse(TO);
  const ticks = timedTicksOf({ ticks: [{ observedAtIso: FROM, openSeats: 20, workingSeats: 20 }], toMs });
  return burnOf({
    aliases: ["alpha"],
    fromMs,
    samples: weeklySamplesOf({
      samples: [sample({ observedAtIso: FROM, utilization: 0 }), sample({ observedAtIso: TO, utilization: to })],
      toMs,
    }),
    seatIntervals: seatIntervalsOf({ fromMs, ticks: ticks.timed, toMs }),
    toMs,
  });
}

describe("burnOf", () => {
  it("measures a draw of 0.2 plan-weeks over 20 seats for ten minutes as 0.06 per working seat-hour", () => {
    const burn = burnRisingTo({ to: 0.2 });

    expect(burn).toEqual({
      kind: "measured",
      overlapHours: 1 / 6,
      planWeeksDrawn: 0.2,
      planWeeksPerWorkingSeatHour: 0.2 / (20 / 6),
      workingSeatHours: 20 / 6,
    });
  });

  it("refuses a positive draw that divides to zero, so no ceiling is ever divided by it", () => {
    const burn = burnRisingTo({ to: Number.MIN_VALUE });

    expect(burn).toEqual({
      kind: "unmeasurable",
      reason: "the plans drew nothing measurable while seats were working",
    });
  });
});

describe("timedTicksOf", () => {
  it("keeps ticks at or before the end in instant order and names the one that does not parse", () => {
    const toMs = Date.parse(TO);
    const ticks = timedTicksOf({
      ticks: [
        { observedAtIso: "2026-10-04T00:05:00.000Z", openSeats: 3, workingSeats: 2 },
        { observedAtIso: "2026-10-04T00:11:00.000Z", openSeats: 9, workingSeats: 9 },
        { observedAtIso: "not an instant", openSeats: 1, workingSeats: 1 },
        { observedAtIso: FROM, openSeats: 4, workingSeats: 1 },
      ],
      toMs,
    });

    expect(ticks.timed.map(({ tick }) => tick.observedAtIso)).toEqual([FROM, "2026-10-04T00:05:00.000Z"]);
    expect(ticks.problems).toEqual([
      'a tick at "not an instant" carries an instant that does not parse, and was not counted',
    ]);
  });
});
