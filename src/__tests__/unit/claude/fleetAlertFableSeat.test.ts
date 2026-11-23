/**
 * A REACT NOW line on a window that stops every spawn names where a Fable seat goes when routing sends it
 * somewhere a worker would not: a Fable seat is refused at the routing bar on a plan-wide week a worker may still
 * spend out in its last five hours.
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge } from "../../../claude/contracts.js";
import { fleetBudgetAlert } from "../../../claude/fleetAlert.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";

const OBSERVED = "2026-11-06T04:40:00.000Z";
const LATE_RESET = "2026-11-12T04:00:00.000Z";

const plan = ({
  alias,
  fable,
  reset = LATE_RESET,
  week,
}: {
  alias: string;
  fable: number;
  reset?: string;
  week: number;
}): ClaudePlanGauge => ({
  alias,
  allowance: WEEKLY_WINDOW,
  observedAtIso: OBSERVED,
  sevenDay: { resetAtIso: reset, status: "allowed", utilization: week },
  sevenDayFable: { resetAtIso: LATE_RESET, status: "allowed", utilization: fable },
  usageLimitPercent: 100,
});

const weekLine = ({ gauges }: { gauges: readonly ClaudePlanGauge[] }): string =>
  fleetBudgetAlert({ configured: gauges.length, gauges, thresholds: DEFAULT_THRESHOLDS.claude }).reactNow.find((line) =>
    line.startsWith("REACT NOW — plan-a week "),
  )!;

describe("fleetBudgetAlert names a Fable seat's own destination", () => {
  it("sends workers to a plan spending out its last five hours and a Fable seat past it", () => {
    const gauges = [
      plan({ alias: "plan-a", fable: 1, week: 0.8 }),
      plan({ alias: "plan-b", fable: 0, reset: "2026-11-06T07:00:00.000Z", week: 0.95 }),
      plan({ alias: "plan-c", fable: 0.2, week: 0.7 }),
    ];

    expect(weekLine({ gauges })).toBe(
      `REACT NOW — plan-a week at 80%, resets ${LATE_RESET}: it stops every spawn; move them to plan-b (a Fable seat to plan-c)`,
    );
  });

  it("says so when no other plan can take a Fable seat", () => {
    const gauges = [
      plan({ alias: "plan-a", fable: 0.1, week: 0.8 }),
      plan({ alias: "plan-b", fable: 0, reset: "2026-11-06T07:00:00.000Z", week: 0.95 }),
      plan({ alias: "plan-c", fable: 1, week: 0.7 }),
    ];

    expect(weekLine({ gauges })).toBe(
      `REACT NOW — plan-a week at 80%, resets ${LATE_RESET}: it stops every spawn; move them to plan-b (no other plan can take a Fable seat)`,
    );
  });

  it("names a Fable seat's destination on the merged every-plan line too", () => {
    const gauges = [
      plan({ alias: "plan-a", fable: 1, reset: "2026-11-12T00:00:00.000Z", week: 0.8 }),
      plan({ alias: "plan-b", fable: 0.8, reset: "2026-11-13T00:00:00.000Z", week: 0.9 }),
    ];
    const [line] = fleetBudgetAlert({ configured: 2, gauges, thresholds: DEFAULT_THRESHOLDS.claude }).reactNow;

    expect(line).toBe(
      "REACT NOW — every plan past 75%, spawns go to plan-a (a Fable seat to plan-b); the fleet stalls at the first plan to fill, next reset plan-a 2026-11-12T00:00:00.000Z",
    );
  });

  it("names one destination when a worker and a Fable seat route to the same plan", () => {
    const gauges = [plan({ alias: "plan-a", fable: 0.1, week: 0.8 }), plan({ alias: "plan-c", fable: 0.2, week: 0.3 })];

    expect(weekLine({ gauges })).toBe(
      `REACT NOW — plan-a week at 80%, resets ${LATE_RESET}: it stops every spawn; move them to plan-c`,
    );
  });
});
