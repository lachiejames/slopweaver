/**
 * `measureFleetCeiling` over a plan whose week resets AT the span's end — the slot a weekly firing and a plan's own
 * reset can share. MEASURED: a weekly firing fell on a plan's own reset and read the ceiling
 * unmeasurable; repro `slopweaver fleet ceiling --now <the reset instant> --days 7`, which now reads 7 seats.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../lib/result.js";
import {
  ceilingFixture,
  HOUR_FROM,
  HOUR_TO,
  measureFleetCeiling,
  THREE_WORKING,
  weekly,
} from "./seatCeilingFixtures.js";

describe("measureFleetCeiling — a plan whose week resets at the span's end", () => {
  it("starts a plan whose week resets at the span's end at a fresh week, as a weekly firing's slot can", () => {
    // MEASURED: a weekly firing fell on a plan's own reset and read the ceiling unmeasurable.
    // alpha rolls to 0 with 168h to run: 0.95 / 168 = 0.00565…; + beta 0.01 = 0.01565…; ÷ 0.003 = 5.22 → 5.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: ceilingFixture({ alphaReset: HOUR_TO, betaReset: "2026-10-04T21:00:00.000Z" }),
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.ceiling).toMatchObject({
      kind: "measured",
      plans: [
        {
          hoursToReset: 168,
          observedAtIso: HOUR_TO,
          planAlias: "alpha",
          resetAtIso: "2026-10-11T01:00:00.000Z",
          spendCap: 0.95,
          utilization: 0,
        },
        { hoursToReset: 20, planAlias: "beta", utilization: 0.75 },
      ],
      seats: 5,
    });
  });
});
