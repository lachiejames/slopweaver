/**
 * A Fable seat is gated and ranked on the BINDING week. The incident: `cmux spawn
 * fresh-supervisor-handoff-9369 --driver claude --model fable` printed `claude routing: plan-two for a fable spawn —
 * fable-week 44%` while plan-two's all-models week read 95%, 2h20m before its reset. Inside those five hours
 * the house bar lifts to 100%, so the chair's successor booted onto a plan about to wall.
 */
import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { renderSpawnRoute } from "../../../claude/routeSpawn.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { planExcludedBy, rankClaudePlans, routeSpawnToPlan } from "./defaultThresholds.js";

/** The spawn's instant: 2h20m before plan-two's reset, inside its last five hours. */
const OBSERVED = "2026-11-06T04:40:00.000Z";

/**
 * One weekly plan with no five-hour limit (the Ultra shape these plans carry), both weeks resetting together.
 *
 * @param alias the plan
 * @param week the all-models week's utilization
 * @param fable the Fable week's utilization
 * @param resetAtIso when both weeks reset
 * @returns the gauge
 */
function plan({
  alias,
  fable,
  resetAtIso,
  week,
}: {
  alias: string;
  fable: number;
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
    observedAtIso: OBSERVED,
    sevenDay: reading({ utilization: week }),
    sevenDayFable: reading({ utilization: fable }),
    usageLimitPercent: 100,
  };
}

const PLAN_TWO = plan({ alias: "plan-two", fable: 0.44, resetAtIso: "2026-11-06T07:00:00.000Z", week: 0.95 });
const PLAN_FIVE = plan({ alias: "plan-five", fable: 0, resetAtIso: "2026-11-11T11:00:00.000Z", week: 0.22 });

describe("a Fable spawn inside a plan's last five hours", () => {
  it("refuses the plan whose all-models week is at the routing bar, whatever its Fable week reads", () => {
    expect(planExcludedBy({ gauge: PLAN_TWO, modelClass: "fable" })).toStrictEqual({
      alias: "plan-two",
      eligibleAtIso: "2026-11-06T07:00:00.000Z",
      kind: "routing-bar",
      reason: "seven_day at 95%",
    });
  });

  it("routes the chair's successor to the plan with headroom on both weeks, and says what it passed over", () => {
    const route = routeSpawnToPlan({ gauges: [PLAN_TWO, PLAN_FIVE], model: "fable" });

    expect(renderSpawnRoute({ route })).toBe(
      "claude routing: plan-five for a fable spawn — fable-week 0%, all-models week 22%, " +
        "read 2026-11-06T04:40:00.000Z; passed over plan-two seven_day at 95%",
    );
  });

  it("still lets an all-models worker spend the last five hours out to 100%, so that capacity does not strand", () => {
    expect(planExcludedBy({ gauge: PLAN_TWO, modelClass: "all-models" })).toBeUndefined();
  });

  it("refuses a lone plan at 96% rather than seating the chair on it", () => {
    const at96 = plan({ alias: "plan-two", fable: 0.47, resetAtIso: "2026-11-06T07:00:00.000Z", week: 0.96 });
    const route = routeSpawnToPlan({ gauges: [at96], model: "fable" });

    expect(renderSpawnRoute({ route })).toBe(
      "claude routing: NO plan can take a fable spawn — back 2026-11-06T07:00:00.000Z; passed over plan-two seven_day at 96%",
    );
  });
});

describe("the chair, and only the chair, is held to the routing bar on its Fable week too", () => {
  // A Fable week at 97% half an hour from its reset: the last-five-hours lift lets a short Fable seat spend it out.
  const fableClosing = plan({ alias: "plan-one", fable: 0.97, resetAtIso: "2026-11-06T05:10:00.000Z", week: 0.5 });

  it("refuses the chair on a Fable week past the routing bar inside its last five hours", () => {
    expect(planExcludedBy({ chair: true, gauge: fableClosing, modelClass: "fable" })).toStrictEqual({
      alias: "plan-one",
      eligibleAtIso: "2026-11-06T05:10:00.000Z",
      kind: "routing-bar",
      reason: "seven_day_fable at 97%",
    });
  });

  it("keeps the lift for every other Fable seat on the same plan", () => {
    expect(planExcludedBy({ chair: false, gauge: fableClosing, modelClass: "fable" })).toBeUndefined();
  });

  it("routes the chair's successor past that plan, naming it", () => {
    const route = routeSpawnToPlan({ chair: true, gauges: [fableClosing, PLAN_FIVE], model: "fable" });

    expect(renderSpawnRoute({ route })).toBe(
      "claude routing: plan-five for a fable spawn — fable-week 0%, all-models week 22%, " +
        "read 2026-11-06T04:40:00.000Z; passed over plan-one seven_day_fable at 97%",
    );
  });
});

describe("a Fable spawn ranks on the binding headroom", () => {
  it("prefers the plan with room on both weeks over one whose Fable week is emptier but whose plan-wide week is ahead", () => {
    const reset = "2026-11-09T00:00:00.000Z";
    const fableRoomOnly = plan({ alias: "fable-room-only", fable: 0.05, resetAtIso: reset, week: 0.9 });
    const roomOnBoth = plan({ alias: "room-on-both", fable: 0.3, resetAtIso: reset, week: 0.35 });
    const ranking = rankClaudePlans({ gauges: [fableRoomOnly, roomOnBoth], modelClass: "fable" });

    expect(ranking.ranked.map((gauge) => gauge.alias)).toStrictEqual(["room-on-both", "fable-room-only"]);
  });
});
