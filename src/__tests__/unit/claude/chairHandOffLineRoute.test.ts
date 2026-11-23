/**
 * The chair's spawn and the chair's own first close agree on which plan a chair may sit on. The incident: the
 * chair was routed to plan-one at 87% of its week, because 8h40m from its reset that plan sat furthest below its
 * level line; its first close, one tick later, read 88%, past the 75% alert bar, while its own
 * draw had moved the route to plan-three by under a point, so it said HAND OFF THIS TICK after one pass and about
 * 167k of context. The readings below are that tick's own gauge (`supervisor-scratch/handoff-<n>/tick-1/digest.txt`).
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { CHAIR_LEVEL_BAND } from "../../../claude/loadBalance.js";
import type { ClaudeSpawnRoute } from "../../../claude/routeSpawn.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import type { ChairCadenceGauge } from "../../../supervisor/chairCadence.js";
import { planReasons } from "../../../supervisor/chairCadenceBudget.js";
import { chairLevelWith, routeSpawnToPlan } from "./defaultThresholds.js";

/** The chair's spawn, and its first close twelve minutes later. */
const SPAWN = "2026-11-14T18:20:00.000Z";
const CLOSE = "2026-11-14T18:32:00.000Z";

/**
 * One weekly plan with no five-hour limit, both weeks resetting together, as every plan in the digest did.
 *
 * @param alias the plan
 * @param week the all-models week's utilization
 * @param fable the Fable week's utilization
 * @param resetAtIso when both weeks reset
 * @param observedAtIso when the reading was taken
 * @returns the gauge
 */
function plan({
  alias,
  fable,
  observedAtIso,
  resetAtIso,
  week,
}: {
  alias: string;
  fable: number;
  observedAtIso: string;
  resetAtIso: string;
  week: number;
}): ClaudePlanGauge {
  const reading = ({ utilization }: { utilization: number }): ClaudeWindowReading => ({
    resetAtIso,
    status: "allowed",
    utilization,
  });
  return {
    alias,
    allowance: WEEKLY_WINDOW,
    observedAtIso,
    sevenDay: reading({ utilization: week }),
    sevenDayFable: reading({ utilization: fable }),
    usageLimitPercent: 100,
  };
}

/**
 * The five plans as the digest read them, plan-one's week at the given utilization.
 *
 * @param observedAtIso when the readings were taken
 * @param planOneWeek plan-one's all-models week, 0.87 at the spawn and 0.88 at the close
 * @returns every plan's gauge, in configured order
 */
function fleet({ observedAtIso, planOneWeek }: { observedAtIso: string; planOneWeek: number }): ClaudePlanGauge[] {
  return [
    plan({ alias: "plan-one", fable: 0.36, observedAtIso, resetAtIso: "2026-11-15T03:00:00.000Z", week: planOneWeek }),
    plan({ alias: "plan-two", fable: 0.16, observedAtIso, resetAtIso: "2026-11-20T07:00:00.000Z", week: 0.15 }),
    plan({ alias: "plan-three", fable: 0.19, observedAtIso, resetAtIso: "2026-11-19T19:00:00.000Z", week: 0.22 }),
    plan({ alias: "plan-four", fable: 0.6, observedAtIso, resetAtIso: "2026-11-14T22:00:00.000Z", week: 0.9 }),
    plan({ alias: "plan-five", fable: 0.14, observedAtIso, resetAtIso: "2026-11-18T11:00:00.000Z", week: 0.54 }),
  ];
}

/**
 * The plan a route landed on, throwing when no plan could take the spawn — every case here has an eligible plan.
 *
 * @param route the routing pass's conclusion
 * @returns the routed plan's alias
 */
function routedTo({ route }: { route: ClaudeSpawnRoute }): string {
  if (route.kind !== "route") {
    throw new Error(`expected a route, got ${route.kind}`);
  }
  return route.to;
}

/**
 * The tick's captured gauge as `tick close` judges it: every plan's rounded percentages, the chair successor's route
 * and the plans level with it, each as `claude gauge` asks them of the router.
 *
 * @param gauges every plan's reading at the close
 * @param levelCaptured whether the row carries the level plans, false for a row recorded before the gauge did
 * @returns the cadence's gauge
 */
function closeGauge({
  gauges,
  levelCaptured,
}: {
  gauges: readonly ClaudePlanGauge[];
  levelCaptured: boolean;
}): Extract<ChairCadenceGauge, { kind: "read" }> {
  const route = routedTo({ route: routeSpawnToPlan({ chair: true, gauges, model: "fable" }) });
  return {
    ...(levelCaptured ? { chairLevelWith: chairLevelWith({ gauges, route }) } : {}),
    kind: "read",
    nextChair: route,
    plans: gauges.map((gauge) => ({
      fablePct: Math.round(gauge.sevenDayFable!.utilization * 100),
      plan: gauge.alias,
      weekPct: Math.round(gauge.sevenDay.utilization * 100),
    })),
    thresholds: { alertAtPercent: 75, driftingSpreadPercent: 15, routeAtPercent: 95 },
  };
}

describe("a chair spawn and its own first close", () => {
  it("seats the chair on plan-one at 87%, the plan furthest below its level line", () => {
    const route = routeSpawnToPlan({
      chair: true,
      gauges: fleet({ observedAtIso: SPAWN, planOneWeek: 0.87 }),
      model: "fable",
    });

    expect(routedTo({ route })).toBe("plan-one");
  });

  it("moves the chair route to plan-three at the close, with plan-one still level with it, as plan-two is", () => {
    const gauge = closeGauge({ gauges: fleet({ observedAtIso: CLOSE, planOneWeek: 0.88 }), levelCaptured: true });

    expect(gauge.nextChair).toBe("plan-three");
    expect(gauge.chairLevelWith).toStrictEqual(["plan-one", "plan-two"]);
  });

  it("keeps the chair on plan-one at its first close, with no plan reason to hand off on", () => {
    const gauge = closeGauge({ gauges: fleet({ observedAtIso: CLOSE, planOneWeek: 0.88 }), levelCaptured: true });

    expect(planReasons({ alias: "plan-one", gauge })).toStrictEqual({
      notes: [
        "plan-one is at 88% of its seven-day week, but the chair's successor routes to plan-three, level with plan-one within one point of headroom, so a successor would buy no balance — not a reason to hand off until routing moves off it",
      ],
      reasons: [],
    });
  });

  it("still hands off on a row recorded before the gauge carried the level plans, exactly as the digest's close said", () => {
    const gauge = closeGauge({ gauges: fleet({ observedAtIso: CLOSE, planOneWeek: 0.88 }), levelCaptured: false });

    expect(planReasons({ alias: "plan-one", gauge }).reasons).toStrictEqual([
      { alias: "plan-one", kind: "plan-window-near", pct: 88, thresholdPercent: 75, window: "seven-day" },
      {
        alias: "plan-one",
        fablePct: 36,
        kind: "plan-asymmetric",
        routeAlias: "plan-three",
        routeFablePct: 19,
        thresholdPoints: 15,
      },
    ]);
  });

  it("hands the chair off once plan-one's own draw puts it more than a point past the route", () => {
    const gauge = closeGauge({ gauges: fleet({ observedAtIso: CLOSE, planOneWeek: 0.9 }), levelCaptured: true });

    expect(gauge.chairLevelWith).toStrictEqual(["plan-two"]);
    expect(planReasons({ alias: "plan-one", gauge }).reasons.map((reason) => reason.kind)).toStrictEqual([
      "plan-window-near",
      "plan-asymmetric",
    ]);
  });

  it("counts a plan exactly one point behind the route as level, where the raw subtraction reads 0.010000000000000009", () => {
    const at = ({ alias, week }: { alias: string; week: number }): ClaudePlanGauge =>
      plan({
        alias,
        fable: 0.1,
        observedAtIso: "2026-01-06T00:00:00.000Z",
        resetAtIso: "2026-01-08T00:00:00.000Z",
        week,
      });
    const gauges = [at({ alias: "plan-one", week: 0.75 }), at({ alias: "plan-two", week: 0.74 })];
    const route = routedTo({ route: routeSpawnToPlan({ chair: true, gauges, model: "fable" }) });

    expect(route).toBe("plan-two");
    expect(chairLevelWith({ gauges, route })).toStrictEqual(["plan-one"]);
  });

  it("counts level within one whole percent of a week, the resolution the tick reads at", () => {
    expect(CHAIR_LEVEL_BAND).toBe(0.01);
  });
});
