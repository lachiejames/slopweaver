/**
 * The fleet budget card on a plan with an owner-set usage limit: the card fires `alertAt` of the way to a binding
 * weekly limit and says so, the five-hour window keeps the absolute bar, and the merged line's wall is the limit.
 * The unlimited cases sit in `fleetAlert.test.ts`, unchanged.
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { fleetBudgetAlert } from "../../../claude/fleetAlert.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;
const OBSERVED = "2026-09-07T18:45:00.000Z";
const RESET = "2026-09-13T22:00:00.000Z";
/** Inside the last five hours of a week observed at {@link OBSERVED}, where routing lifts an unlimited week. */
const NEAR_RESET = "2026-09-07T21:00:00.000Z";

const window = ({
  resetAtIso = RESET,
  status = "allowed",
  utilization,
}: {
  resetAtIso?: string;
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso, status, utilization });

const plan = ({
  alias,
  fable,
  fiveHour = 0.1,
  limit = 100,
  reset = RESET,
  status = "allowed",
  week,
}: {
  alias: string;
  fable?: number;
  fiveHour?: number;
  limit?: UsageLimitPercent;
  reset?: string;
  status?: ClaudeWindowReading["status"];
  week: number;
}): ClaudePlanGauge => ({
  alias,
  allowance: WEEKLY_WINDOW,
  fiveHour: window({ utilization: fiveHour }),
  observedAtIso: OBSERVED,
  sevenDay: window({ resetAtIso: reset, status, utilization: week }),
  ...(fable === undefined ? {} : { sevenDayFable: window({ utilization: fable }) }),
  usageLimitPercent: limit,
});

/** The card for a fleet of `gauges`, every one configured, at the default thresholds. */
const reactNowOf = ({ gauges }: { gauges: readonly ClaudePlanGauge[] }): readonly string[] =>
  fleetBudgetAlert({ configured: gauges.length, gauges, thresholds: THRESHOLDS }).reactNow;

const ROOMY = plan({ alias: "plan-c", fable: 0.02, week: 0.04 });

describe("the card on a 50%-limited plan", () => {
  it("stays quiet a hair under 37.5% and cards at 37.5%, naming the point and the limit", () => {
    expect(reactNowOf({ gauges: [plan({ alias: "plan-a", limit: 50, week: 0.3749 }), ROOMY] })).toStrictEqual([]);
    expect(reactNowOf({ gauges: [plan({ alias: "plan-a", limit: 50, week: 0.375 }), ROOMY] })).toStrictEqual([
      `REACT NOW — plan-a week at 38%, past its 38% alert point (75% of the way to your 50% usage limit), resets ${RESET}: it stops every spawn; move them to plan-c`,
    ]);
  });

  it("rebases the Fable week the same way", () => {
    const quiet = plan({ alias: "plan-b", fable: 0.3749, limit: 50, week: 0.2 });
    const carded = plan({ alias: "plan-b", fable: 0.375, limit: 50, week: 0.2 });
    expect(reactNowOf({ gauges: [quiet, ROOMY] })).toStrictEqual([]);
    expect(reactNowOf({ gauges: [carded, ROOMY] })).toStrictEqual([
      `REACT NOW — plan-b fable week at 38%, past its 38% alert point (75% of the way to your 50% usage limit), resets ${RESET}: it stops Fable spawns; move them to plan-c`,
    ]);
  });

  it("keeps the five-hour window on the absolute bar, since the limit is a share of the week", () => {
    expect(
      reactNowOf({ gauges: [plan({ alias: "plan-a", fiveHour: 0.7499, limit: 50, week: 0.1 }), ROOMY] }),
    ).toStrictEqual([]);
    expect(
      reactNowOf({ gauges: [plan({ alias: "plan-a", fiveHour: 0.75, limit: 50, week: 0.1 }), ROOMY] }),
    ).toStrictEqual([
      `REACT NOW — plan-a 5h at 75%, resets ${RESET}: it stops every spawn, until it resets; move them to plan-c`,
    ]);
  });

  it("still cards at 37.5% inside the week's last five hours, where a usage limit never lifts", () => {
    expect(
      reactNowOf({ gauges: [plan({ alias: "plan-a", limit: 50, reset: NEAR_RESET, week: 0.375 }), ROOMY] }),
    ).toStrictEqual([
      `REACT NOW — plan-a week at 38%, past its 38% alert point (75% of the way to your 50% usage limit), resets ${NEAR_RESET}: it stops every spawn; move them to plan-c`,
    ]);
  });

  it("cards a provider refusal below the point without claiming the week reached it", () => {
    expect(
      reactNowOf({ gauges: [plan({ alias: "plan-a", limit: 50, status: "rejected", week: 0.2 }), ROOMY] }),
    ).toStrictEqual([
      `REACT NOW — plan-a week at 20% (provider refused it before your 50% usage limit), resets ${RESET}: it stops every spawn; move them to plan-c`,
    ]);
  });

  it("moves with the install's alert bar: 0.6 of a 50% limit cards at 30% and says 60% of the way", () => {
    const thresholds = { ...THRESHOLDS, alertAt: 0.6 };
    const quiet = [plan({ alias: "plan-a", limit: 50, week: 0.2999 }), ROOMY];
    const carded = [plan({ alias: "plan-a", limit: 50, week: 0.3 }), ROOMY];
    expect(fleetBudgetAlert({ configured: 2, gauges: quiet, thresholds }).reactNow).toStrictEqual([]);
    expect(fleetBudgetAlert({ configured: 2, gauges: carded, thresholds }).reactNow).toStrictEqual([
      `REACT NOW — plan-a week at 30%, past its 30% alert point (60% of the way to your 50% usage limit), resets ${RESET}: it stops every spawn; move them to plan-c`,
    ]);
  });
});

describe("the card on a monthly-spend plan, whose limit is a share of the month and never of the week", () => {
  it("keeps its week on the absolute 75% bar however low its usage limit is", () => {
    const monthly = ({ week }: { week: number }): ClaudePlanGauge => ({
      ...plan({ alias: "plan-m", limit: 50, week }),
      allowance: { kind: "monthly-spend" },
    });
    expect(reactNowOf({ gauges: [monthly({ week: 0.7499 }), ROOMY] })).toStrictEqual([]);
    expect(reactNowOf({ gauges: [monthly({ week: 0.75 }), ROOMY] })).toStrictEqual([
      `REACT NOW — plan-m week at 75%, resets ${RESET}: it stops every spawn; move them to plan-c`,
    ]);
  });
});

describe("the merged line over a fleet with a usage limit", () => {
  it("merges once each plan is past its OWN point, and names the share rather than one percentage", () => {
    const gauges = [plan({ alias: "plan-one", limit: 50, week: 0.4 }), plan({ alias: "plan-two", week: 0.79 })];
    expect(reactNowOf({ gauges })).toStrictEqual([
      `REACT NOW — every plan past 75% of the way to its owner-set usage limit, spawns go to plan-one; the fleet stalls at the first plan to fill, next reset plan-one ${RESET}`,
    ]);
  });

  it("does not merge while the unlimited plan is under its own 75%, though it is past the limited plan's point", () => {
    const gauges = [plan({ alias: "plan-one", limit: 50, week: 0.4 }), plan({ alias: "plan-two", week: 0.6 })];
    expect(reactNowOf({ gauges })).toStrictEqual([
      `REACT NOW — plan-one week at 40%, past its 38% alert point (75% of the way to your 50% usage limit), resets ${RESET}: it stops every spawn; move them to plan-two`,
    ]);
  });

  it("counts a 50% plan at exactly 50% as at the wall, inside its last five hours too", () => {
    const gauges = [
      plan({ alias: "plan-one", limit: 50, reset: NEAR_RESET, week: 0.5 }),
      plan({ alias: "plan-two", week: 0.79 }),
    ];
    expect(reactNowOf({ gauges })).toStrictEqual([
      `REACT NOW — every plan past 75% of the way to its owner-set usage limit, spawns go to plan-two; 1 of 2 already at the wall, next reset plan-one ${NEAR_RESET}`,
    ]);
  });
});
