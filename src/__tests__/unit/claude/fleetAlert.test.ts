import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { fleetBudgetAlert } from "../../../claude/fleetAlert.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

/** The alert under the default thresholds, which every case below not about a threshold is judged by. */
const alertFor = ({ configured, gauges }: { configured: number; gauges: readonly ClaudePlanGauge[] }) =>
  fleetBudgetAlert({ configured, gauges, thresholds: THRESHOLDS });

/** A weekly-window plan with no usage limit set, so every case below is judged by the house bar alone. */
const POLICY = { allowance: WEEKLY_WINDOW, usageLimitPercent: 100 } as const;

const OBSERVED = "2026-09-07T18:45:00.000Z";
const RESET = "2026-09-13T22:00:00.000Z";

const window = ({
  status = "allowed",
  utilization,
}: {
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso: RESET, status, utilization });

const plan = ({
  alias,
  fable,
  fiveHour = 0.1,
  week,
}: {
  alias: string;
  fable?: number;
  fiveHour?: number;
  week: number;
}): ClaudePlanGauge => ({
  alias,
  ...POLICY,
  fiveHour: window({ utilization: fiveHour }),
  observedAtIso: OBSERVED,
  sevenDay: window({ utilization: week }),
  ...(fable === undefined ? {} : { sevenDayFable: window({ utilization: fable }) }),
});

describe("the card threshold sits below the two numbers it leads", () => {
  it("fires before routing stops choosing a plan, and before the 90% the owner named", () => {
    expect(THRESHOLDS.alertAt).toBeLessThan(THRESHOLDS.routeAt);
    expect(THRESHOLDS.alertAt).toBeLessThan(0.9);
  });

  it("no longer requires routing to stop below 90 — a later owner ruling moved the cap past it", () => {
    expect(THRESHOLDS.routeAt).toBe(0.95);
  });

  it("moves the card with the install's alert bar: a 65% plan is quiet by default and carded at 0.6", () => {
    const gauges = [plan({ alias: "plan-a", week: 0.65 }), plan({ alias: "plan-c", week: 0.04 })];
    const byDefault = fleetBudgetAlert({ configured: 2, gauges, thresholds: THRESHOLDS });
    const lowered = fleetBudgetAlert({ configured: 2, gauges, thresholds: { ...THRESHOLDS, alertAt: 0.6 } });
    expect(byDefault.reactNow).toStrictEqual([]);
    expect(lowered.reactNow).toStrictEqual([
      `REACT NOW — plan-a week at 65%, resets ${RESET}: it stops every spawn; move them to plan-c`,
    ]);
  });

  it("names the install's alert bar in the merged line", () => {
    const gauges = [
      plan({ alias: "plan-one", week: 0.65 }),
      {
        ...plan({ alias: "plan-two", week: 0.62 }),
        sevenDay: { resetAtIso: "2026-09-14T06:00:00.000Z", status: "allowed" as const, utilization: 0.62 },
      },
    ];
    const alert = fleetBudgetAlert({ configured: 2, gauges, thresholds: { ...THRESHOLDS, alertAt: 0.6 } });
    expect(alert.reactNow[0]).toContain("every plan past 60%");
  });
});

describe("fleetBudgetAlert", () => {
  it("folds every plan into one line each tick, saying which numbers were not measured", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [plan({ alias: "plan-a", fable: 0.53, week: 0.4 }), plan({ alias: "plan-b", week: 0.1 })],
    });
    expect(alert.fold).toBe("claude budget: plan-a 40% week / 53% fable, plan-b 10% week / unread fable");
    expect(alert.reactNow).toStrictEqual([]);
  });

  it("cards a closing plan-wide week and names the plan to move every spawn to", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [plan({ alias: "plan-a", fable: 0.5, week: 0.78 }), plan({ alias: "plan-c", fable: 0.02, week: 0.04 })],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — plan-a week at 78%, resets ${RESET}: it stops every spawn; move them to plan-c`,
    ]);
  });

  it("cards a closing FABLE week as stopping only Fable spawns", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [plan({ alias: "plan-b", fable: 0.81, week: 0.3 }), plan({ alias: "plan-c", fable: 0.02, week: 0.04 })],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — plan-b fable week at 81%, resets ${RESET}: it stops Fable spawns; move them to plan-c`,
    ]);
  });

  it("names the plan the router picks, furthest below its own level line, never merely the least used", () => {
    // plan-soon sits far below a line nearly at its cap by tomorrow, plan-later above a line barely begun, so the next spawn
    // routes to plan-soon; the lowest level alone would have sent the owner to plan-later.
    const soon: ClaudePlanGauge = {
      ...plan({ alias: "plan-soon", week: 0.6 }),
      sevenDay: { resetAtIso: "2026-09-08T18:45:00.000Z", status: "allowed", utilization: 0.6 },
    };
    const alert = alertFor({
      configured: 3,
      gauges: [plan({ alias: "plan-a", week: 0.78 }), plan({ alias: "plan-later", week: 0.55 }), soon],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — plan-a week at 78%, resets ${RESET}: it stops every spawn; move them to plan-soon`,
    ]);
  });

  it("names the router's pick even when that plan is itself past the alert's threshold", () => {
    // Claude fallback review r1: plan-b at 80% loses 15 points tomorrow, so the router fills it before plan-c at
    // 10% resetting in six days; the alert's own 75% must not strike it from the answer first.
    const soon: ClaudePlanGauge = {
      ...plan({ alias: "plan-b", week: 0.8 }),
      sevenDay: { resetAtIso: "2026-09-08T18:45:00.000Z", status: "allowed", utilization: 0.8 },
    };
    const alert = alertFor({
      configured: 3,
      gauges: [plan({ alias: "plan-a", week: 0.78 }), soon, plan({ alias: "plan-c", week: 0.1 })],
    });
    expect(alert.reactNow[0]).toBe(
      `REACT NOW — plan-a week at 78%, resets ${RESET}: it stops every spawn; move them to plan-b`,
    );
  });

  it("names a plan whose Fable week was not read when the router would send the Fable spawn there", () => {
    // Claude fallback review r2: with no read Fable week elsewhere, the router falls back to plan-b's week.
    const alert = alertFor({
      configured: 2,
      gauges: [plan({ alias: "plan-a", fable: 0.8, week: 0.3 }), plan({ alias: "plan-b", week: 0.2 })],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — plan-a fable week at 80%, resets ${RESET}: it stops Fable spawns; move them to plan-b`,
    ]);
  });

  it("never names a destination whose PLAN-WIDE week would refuse the Fable spawns it is sent", () => {
    const spentWeek: ClaudePlanGauge = {
      alias: "plan-a",
      fiveHour: window({ utilization: 0.1 }),
      ...POLICY,
      observedAtIso: OBSERVED,
      sevenDay: window({ status: "rejected", utilization: 1 }),
      sevenDayFable: window({ utilization: 0.1 }),
    };
    const alert = alertFor({
      configured: 2,
      gauges: [plan({ alias: "plan-b", fable: 0.81, week: 0.3 }), spentWeek],
    });
    expect(alert.reactNow[0]).toContain("and no other plan can take them");
  });

  it("cards a REFUSED window whatever its utilization reads", () => {
    const refused: ClaudePlanGauge = {
      alias: "plan-a",
      fiveHour: window({ utilization: 0.1 }),
      ...POLICY,
      observedAtIso: OBSERVED,
      sevenDay: window({ status: "rejected", utilization: 1 }),
    };
    const alert = alertFor({ configured: 1, gauges: [refused] });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — plan-a week at 100%, resets ${RESET}: it stops every spawn; and no other plan can take them`,
    ]);
  });

  it("says so plainly when nothing was readable, rather than rendering an empty healthy fleet", () => {
    expect(alertFor({ configured: 0, gauges: [] })).toStrictEqual({
      fold: "claude budget: no plan was readable this tick",
      reactNow: [],
    });
  });
});

describe("the merged line", () => {
  const WEEK_A = "2026-09-13T22:00:00.000Z";
  const WEEK_B = "2026-09-14T06:00:00.000Z";

  /** A plan whose week resets at its own instant, so the merged line has a soonest to name. */
  const dated = ({
    alias,
    reset,
    status = "allowed",
    week,
  }: {
    alias: string;
    reset: string;
    status?: ClaudeWindowReading["status"];
    week: number;
  }): ClaudePlanGauge => ({
    alias,
    ...POLICY,
    fiveHour: window({ utilization: 0.1 }),
    observedAtIso: OBSERVED,
    sevenDay: { resetAtIso: reset, status, utilization: week },
  });

  it("replaces every per-window line with one, once every plan's week is past 75%", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [
        dated({ alias: "plan-one", reset: WEEK_A, week: 0.88 }),
        dated({ alias: "plan-two", reset: WEEK_B, week: 0.79 }),
      ],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — every plan past 75%, spawns go to plan-two; the fleet stalls at the first plan to fill, next reset plan-one ${WEEK_A}`,
    ]);
  });

  it("leaves the fold line carrying every plan's own number, so the merge loses no figure", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [
        dated({ alias: "plan-one", reset: WEEK_A, week: 0.88 }),
        dated({ alias: "plan-two", reset: WEEK_B, week: 0.79 }),
      ],
    });
    expect(alert.fold).toBe("claude budget: plan-one 88% week / unread fable, plan-two 79% week / unread fable");
  });

  it("names how many plans the provider has already refused, rather than folding a wall into a warning", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [
        dated({ alias: "plan-one", reset: WEEK_A, status: "rejected", week: 1 }),
        dated({ alias: "plan-two", reset: WEEK_B, week: 0.79 }),
      ],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — every plan past 75%, spawns go to plan-two; 1 of 2 already at the wall, next reset plan-one ${WEEK_A}`,
    ]);
  });

  it("says nothing is left to move only when the router can place no spawn anywhere", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [
        dated({ alias: "plan-one", reset: WEEK_A, status: "rejected", week: 1 }),
        dated({ alias: "plan-two", reset: WEEK_B, status: "rejected", week: 1 }),
      ],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — every plan past 75%, nothing to move; 2 of 2 already at the wall, next reset plan-one ${WEEK_A}`,
    ]);
  });

  it("keeps the per-window lines while one plan is still under 75% and can take the work", () => {
    const alert = alertFor({
      configured: 2,
      gauges: [
        dated({ alias: "plan-one", reset: WEEK_A, week: 0.88 }),
        dated({ alias: "plan-two", reset: WEEK_B, week: 0.4 }),
      ],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — plan-one week at 88%, resets ${WEEK_A}: it stops every spawn; move them to plan-two`,
    ]);
  });

  it("never merges a fleet of one readable plan — that claim is about a fleet nobody read", () => {
    const alert = alertFor({
      configured: 1,
      gauges: [dated({ alias: "plan-one", reset: WEEK_A, week: 0.88 })],
    });
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — plan-one week at 88%, resets ${WEEK_A}: it stops every spawn; and no other plan can take them`,
    ]);
  });

  it("counts a plan spent out past 95% near its own reset as at the wall only once it reaches 100%", () => {
    const nearReset = "2026-09-07T21:00:00.000Z";
    const alert = alertFor({
      configured: 2,
      gauges: [
        dated({ alias: "plan-one", reset: nearReset, week: 0.97 }),
        dated({ alias: "plan-two", reset: WEEK_B, week: 0.79 }),
      ],
    });
    // A Fable seat never takes the last-five-hours lift on a plan-wide week, so it goes to plan-two.
    expect(alert.reactNow).toStrictEqual([
      `REACT NOW — every plan past 75%, spawns go to plan-one (a Fable seat to plan-two); the fleet stalls at the first plan to fill, next reset plan-one ${nearReset}`,
    ]);
  });
});

describe("a merge is a claim about a fleet, so it needs the whole fleet read", () => {
  const WEEK_A = "2026-09-13T22:00:00.000Z";
  const WEEK_B = "2026-09-14T06:00:00.000Z";

  /** Two plans past 75%, out of a fleet of however many the caller says is configured. */
  const bothPastCard: readonly ClaudePlanGauge[] = [
    {
      alias: "plan-one",
      fiveHour: window({ utilization: 0.1 }),
      ...POLICY,
      observedAtIso: OBSERVED,
      sevenDay: { resetAtIso: WEEK_A, status: "allowed", utilization: 0.88 },
    },
    {
      alias: "plan-two",
      fiveHour: window({ utilization: 0.1 }),
      ...POLICY,
      observedAtIso: OBSERVED,
      sevenDay: { resetAtIso: WEEK_B, status: "allowed", utilization: 0.79 },
    },
  ];

  it("merges when every configured plan answered", () => {
    expect(alertFor({ configured: 2, gauges: bothPastCard }).reactNow).toStrictEqual([
      `REACT NOW — every plan past 75%, spawns go to plan-two; the fleet stalls at the first plan to fill, next reset plan-one ${WEEK_A}`,
    ]);
  });

  it("never merges two readable plans of a configured four — the other two were never read", () => {
    expect(alertFor({ configured: 4, gauges: bothPastCard }).reactNow).toStrictEqual([
      `REACT NOW — plan-one week at 88%, resets ${WEEK_A}: it stops every spawn; move them to plan-two`,
      `REACT NOW — plan-two week at 79%, resets ${WEEK_B}: it stops every spawn; move them to plan-one`,
    ]);
  });

  it("leaves the fold line identical whether or not the merge fired", () => {
    const whole = alertFor({ configured: 2, gauges: bothPastCard });
    const partial = alertFor({ configured: 4, gauges: bothPastCard });
    expect(partial.fold).toBe(whole.fold);
  });
});
