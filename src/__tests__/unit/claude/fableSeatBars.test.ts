/**
 * Which bar each window a spawn must clear is judged at: the house bars for a worker, the routing bar held to the
 * reset on a Fable seat's plan-wide week, and on the chair's Fable week as well (an owner ruling).
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import { fableSeatThresholds, gatingWindows } from "../../../claude/fableSeatBars.js";
import { THRESHOLDS } from "./defaultThresholds.js";

const WINDOW = { resetAtIso: "2026-11-06T07:00:00.000Z", status: "allowed", utilization: 0.5 } as const;
const GAUGE: ClaudeAccountGauge = {
  alias: "plan-one",
  fiveHour: WINDOW,
  observedAtIso: "2026-11-06T04:40:00.000Z",
  sevenDay: WINDOW,
  sevenDayFable: WINDOW,
};
const SEAT = fableSeatThresholds({ thresholds: THRESHOLDS });

describe("fableSeatThresholds", () => {
  it("holds the spend-out bar at the routing bar and leaves every other bar alone", () => {
    expect(SEAT).toStrictEqual({ ...THRESHOLDS, spendOutAt: THRESHOLDS.routeAt });
    expect(SEAT.spendOutAt).toBe(0.95);
  });
});

describe("gatingWindows", () => {
  it("judges an all-models spawn's two windows at the house bars, and never names the Fable week", () => {
    const gates = gatingWindows({ chair: false, gauge: GAUGE, modelClass: "all-models", thresholds: THRESHOLDS });

    expect(gates.map(({ label, thresholds }) => [label, thresholds])).toStrictEqual([
      ["five_hour", THRESHOLDS],
      ["seven_day", THRESHOLDS],
    ]);
  });

  it("holds a Fable seat's plan-wide week to the routing bar and leaves its Fable week the lift", () => {
    const gates = gatingWindows({ chair: false, gauge: GAUGE, modelClass: "fable", thresholds: THRESHOLDS });

    expect(gates.map(({ label, thresholds }) => [label, thresholds])).toStrictEqual([
      ["five_hour", THRESHOLDS],
      ["seven_day", SEAT],
      ["seven_day_fable", THRESHOLDS],
    ]);
  });

  it("holds the chair to the routing bar on both weeks", () => {
    const gates = gatingWindows({ chair: true, gauge: GAUGE, modelClass: "fable", thresholds: THRESHOLDS });

    expect(gates.map(({ label, thresholds }) => [label, thresholds])).toStrictEqual([
      ["five_hour", THRESHOLDS],
      ["seven_day", SEAT],
      ["seven_day_fable", SEAT],
    ]);
  });
});
