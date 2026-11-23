/**
 * The survival simulator. Every number asserted is arithmetic a reader can redo from the plan states above
 * it: a plan takes demand until its effective ceiling (0.95, or 1.0 inside its last five hours, and never past
 * its usage limit), strands what is left below its hard stop (1.0, or its usage limit) at its reset, and an hour is
 * dry when no plan has
 * room left once it has been routed.
 */
import { describe, expect, it } from "vitest";
import type { SurvivalPlanState } from "../../../claude/survivalPlanState.js";
import { breakEvenDemand, simulateFleet, TODAYS_ROUTER } from "../../../claude/survivalSimulate.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { UsageLimitPercent } from "../../../plans/usageLimit.js";

const NOW = "2026-10-01T00:00:00.000Z";
const HOUR_MS = 3_600_000;
const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

/** The simulator under the default thresholds, which every case not about a threshold is judged by. */
const simulate = (args: Omit<Parameters<typeof simulateFleet>[0], "thresholds">): ReturnType<typeof simulateFleet> =>
  simulateFleet({ ...args, thresholds: THRESHOLDS });

/** The break-even demand under the default thresholds. */
const breakEven = (args: Omit<Parameters<typeof breakEvenDemand>[0], "thresholds">): number =>
  breakEvenDemand({ ...args, thresholds: THRESHOLDS });

/** A plan state `hours` from its reset, with no five-hour ceiling and no usage limit unless one is given. */
function plan({
  alias,
  hoursToReset,
  utilization,
  absorbPerHour,
  usageLimitPercent = 100,
}: {
  alias: string;
  hoursToReset: number;
  utilization: number;
  absorbPerHour?: number;
  usageLimitPercent?: UsageLimitPercent;
}): SurvivalPlanState {
  return {
    absorbPerHour,
    alias,
    fableResetAtIso: undefined,
    fableUtilization: undefined,
    observedAtIso: NOW,
    resetAtIso: new Date(Date.parse(NOW) + hoursToReset * HOUR_MS).toISOString(),
    usageLimitPercent,
    utilization,
  };
}

/** An instant `hours` from {@link NOW}. */
function at({ hours }: { hours: number }): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

describe("simulateFleet", () => {
  it("lets every reset inside a dry stretch end or split it, not only the one that ends the last spell", () => {
    // Usage resets are a thing and must be modelled. With a's reset at +10h inside the
    // stretch, a's fresh week carries seats until it is spent (0.95 at 0.2 an hour: four whole hours), so one 20h
    // stretch becomes 10h and 6h.
    const spells = ({ aResetsIn }: { aResetsIn: number }) =>
      simulate({
        demandPerHour: 0.2,
        nowIso: NOW,
        router: TODAYS_ROUTER,
        states: [
          plan({ alias: "a", hoursToReset: aResetsIn, utilization: 0.95 }),
          plan({ alias: "b", hoursToReset: 20, utilization: 0.95 }),
        ],
        weeks: 1,
      }).drySpells.map((spell) => [spell.hours, spell.endedByAlias, spell.endedBy]);
    expect(spells({ aResetsIn: 40 })[0]).toEqual([20, "b", "reset"]);
    expect(spells({ aResetsIn: 10 }).slice(0, 2)).toEqual([
      [10, "a", "reset"],
      [6, "b", "reset"],
    ]);
  });

  it("runs dry at once when the install's route bar sits under the plan's level, where the default has room", () => {
    const base = {
      demandPerHour: 0.01,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 100, utilization: 0.85 })],
      weeks: 1,
    } as const;
    const lowered = simulateFleet({ ...base, thresholds: { ...THRESHOLDS, routeAt: 0.8 } });
    expect(lowered.drySpells[0]!.startIso).toBe(NOW);
    expect(simulate(base).drySpells[0]!.startIso).not.toBe(NOW);
  });

  it("strands the whole unspent week at each reset when there is no demand", () => {
    const outcome = simulate({
      demandPerHour: 0,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "a", hoursToReset: 10, utilization: 0.4 })],
      weeks: 1,
    });
    expect(outcome.drySpells).toEqual([]);
    expect(outcome.weeks[0]!.dryHours).toBe(0);
    expect(outcome.weeks[0]!.strandedPlanWeeks).toBeCloseTo(0.6, 9);
  });

  it("counts no dry hour at zero demand, even with every plan already at its cap", () => {
    const outcome = simulate({
      demandPerHour: 0,
      nowIso: NOW,
      router: "headroom",
      states: [plan({ alias: "a", hoursToReset: 50, utilization: 0.95 })],
      weeks: 1,
    });
    expect(outcome.drySpells).toEqual([]);
    expect(outcome.weeks[0]!.dryHours).toBe(0);
  });

  it("earliest-reset spends the week that is lost soonest, where least-used splits it and strands more", () => {
    const states = [
      plan({ alias: "soon", hoursToReset: 24, utilization: 0 }),
      plan({ alias: "late", hoursToReset: 200, utilization: 0 }),
    ];
    const run = ({ router }: { router: "least-used" | "earliest-reset" | "headroom" }) =>
      simulate({ demandPerHour: 0.01, nowIso: NOW, router, states, weeks: 1 }).weeks[0]!.strandedPlanWeeks;
    expect(run({ router: "earliest-reset" })).toBeCloseTo(0.76, 6);
    expect(run({ router: "headroom" })).toBeCloseTo(0.76, 6);
    expect(run({ router: "least-used" })).toBeCloseTo(0.88, 3);
  });

  it("headroom, today's router, leaves less of a week resetting tomorrow than least-used, and caps no plan early", () => {
    // least-used spends `late` (lower level) and `soon` strands its 20 points at 24:00; headroom shares the demand
    // by how far each sits below its own level line, so `soon` is drawn too.
    const states = [
      plan({ alias: "soon", hoursToReset: 24, utilization: 0.8 }),
      plan({ alias: "late", hoursToReset: 100, utilization: 0.3 }),
    ];
    const run = ({ router }: { router: "least-used" | "headroom" }) =>
      simulate({ demandPerHour: 0.008, nowIso: NOW, router, states, weeks: 1 }).weeks[0]!;
    expect(run({ router: "headroom" }).strandedPlanWeeks).toBeLessThan(run({ router: "least-used" }).strandedPlanWeeks);
    expect(run({ router: "headroom" }).earlyCaps).toEqual([]);
  });

  it("names a dry spell and the reset that ends it", () => {
    const outcome = simulate({
      demandPerHour: 0.1,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 10, utilization: 0.9 })],
      weeks: 1,
    });
    // The 0.05 the 1.0 cap frees at 05:00 is less than the hour's 0.1, so the spell runs on to the reset.
    expect(outcome.drySpells[0]).toEqual({
      endedAtIso: "2026-10-01T10:00:00.000Z",
      endedBy: "reset",
      endedByAlias: "only",
      hours: 10,
      reliefHours: 0,
      startIso: NOW,
    });
  });

  it("ends a spell at the reset instant itself when the simulation steps off the hour", () => {
    const outcome = simulate({
      demandPerHour: 0.1,
      nowIso: "2026-10-01T00:30:00.000Z",
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 10, utilization: 0.9 })],
      weeks: 1,
    });
    expect(outcome.drySpells[0]!.endedAtIso).toBe("2026-10-01T10:00:00.000Z");
    expect(outcome.drySpells[0]!.startIso).toBe("2026-10-01T00:30:00.000Z");
  });

  it("ends a spell where the last-five-hours lift frees enough room, when no dry hour follows before the reset", () => {
    const outcome = simulate({
      demandPerHour: 0.01,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 10, utilization: 0.95 })],
      weeks: 1,
    });
    // 00–04 at the 0.95 cap; the 0.05 the 05:00 lift frees carries five hours of 0.01, up to the 10:00 reset.
    expect(outcome.drySpells[0]).toEqual({
      endedAtIso: "2026-10-01T05:00:00.000Z",
      endedBy: "final-hours",
      endedByAlias: "only",
      hours: 5,
      reliefHours: 0,
      startIso: NOW,
    });
  });

  it("reads a reprieve the lift gives as part of one spell, reports every spell, and follows one past the horizon", () => {
    const outcome = simulate({
      demandPerHour: 1 / 64,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 10, utilization: 0.95 })],
      weeks: 1,
    });
    // 00–04 at the 0.95 cap; 05:00 lifts it to 1.0 and three hours of 1/64 fit in the 0.05 it frees; 08–09 run
    // dry to the reset — one spell of 7 dry hours with 3 of relief. The fresh week holds 0.95 × 64 = 60.8 hours
    // of demand, so the 70th hour (day 3, 22:00) runs short and stays short past the one-week horizon, through
    // the lift at day 8, 05:00 (3 hours of relief again) to the 10:00 reset: 103 + 2 dry hours.
    expect(outcome.drySpells).toEqual([
      {
        endedAtIso: "2026-10-01T10:00:00.000Z",
        endedBy: "reset",
        endedByAlias: "only",
        hours: 7,
        reliefHours: 3,
        startIso: NOW,
      },
      {
        endedAtIso: "2026-10-08T10:00:00.000Z",
        endedBy: "reset",
        endedByAlias: "only",
        hours: 105,
        reliefHours: 3,
        startIso: "2026-10-03T22:00:00.000Z",
      },
    ]);
    expect(outcome.weeks[0]!.dryHours).toBe(5 + 2 + 98);
  });

  it("records each cycle's early cap once, the refilled week included", () => {
    const outcome = simulate({
      demandPerHour: 0.1,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 10, utilization: 0.9 })],
      weeks: 1,
    });
    // 0.95 of a fresh week at 0.1 an hour is 9.5 hours: the week that opens at 10:00 caps in the 19:00 hour.
    expect(outcome.weeks[0]!.earlyCaps).toEqual([
      { alias: "only", atIso: NOW, hoursBeforeReset: 10 },
      { alias: "only", atIso: "2026-10-01T19:00:00.000Z", hoursBeforeReset: 159 },
    ]);
  });

  it("records no early cap for a plan that first reaches its wall inside its last five hours", () => {
    const outcome = simulate({
      demandPerHour: 0.02,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 4, utilization: 0.9 })],
      weeks: 1,
    });
    // The 02:00 hour crosses 0.95 under the 1.0 spend-out cap, so only the next week's 03:00 cap on day 3 counts.
    expect(outcome.weeks[0]!.earlyCaps).toEqual([
      { alias: "only", atIso: "2026-10-03T03:00:00.000Z", hoursBeforeReset: 121 },
    ]);
  });

  it("throttles one plan to its five-hour ceiling: the excess goes unmet, yet no hour is dry", () => {
    const outcome = simulate({
      demandPerHour: 0.002,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ absorbPerHour: 0.001, alias: "only", hoursToReset: 1000, utilization: 0 })],
      weeks: 1,
    });
    expect(outcome.weeks[0]!.unmetPlanWeeks).toBeCloseTo(0.168, 9);
    expect(outcome.weeks[0]!.dryHours).toBe(0);
  });
});

describe("simulateFleet, every plan held to its usage limit", () => {
  // A user's fifty percent limit is respected even if it means taking the fleet down: maximise to the user's
  // cap, never over it.
  it("runs dry the moment a plan sits at its usage limit, where the whole plan still has room", () => {
    const run = ({ usageLimitPercent }: { usageLimitPercent: UsageLimitPercent }) =>
      simulate({
        demandPerHour: 0.01,
        nowIso: NOW,
        router: "headroom",
        states: [plan({ alias: "only", hoursToReset: 100, usageLimitPercent, utilization: 0.5 })],
        weeks: 1,
      });
    expect(run({ usageLimitPercent: 50 }).drySpells[0]!.startIso).toBe(NOW);
    expect(run({ usageLimitPercent: 100 }).drySpells[0]!.startIso).toBe(at({ hours: 45 }));
  });

  it("never lifts a limited plan in its last five hours, so the spell runs on to the reset", () => {
    const outcome = simulate({
      demandPerHour: 0.01,
      nowIso: NOW,
      router: "headroom",
      states: [plan({ alias: "only", hoursToReset: 4, usageLimitPercent: 50, utilization: 0.5 })],
      weeks: 1,
    });
    expect(outcome.drySpells[0]).toEqual({
      endedAtIso: at({ hours: 4 }),
      endedBy: "reset",
      endedByAlias: "only",
      hours: 4,
      reliefHours: 0,
      startIso: NOW,
    });
  });

  it("strands only what the owner allowed and nobody spent, never the share above the limit", () => {
    const outcome = simulate({
      demandPerHour: 0,
      nowIso: NOW,
      router: "headroom",
      states: [plan({ alias: "a", hoursToReset: 10, usageLimitPercent: 50, utilization: 0.2 })],
      weeks: 1,
    });
    expect(outcome.drySpells).toEqual([]);
    expect(outcome.weeks[0]!.dryHours).toBe(0);
    expect(outcome.weeks[0]!.strandedPlanWeeks).toBeCloseTo(0.3, 9);
  });

  it("strands an unlimited plan's whole unspent week whatever the spend-out bar is set to", () => {
    // A 0.99 spend-out bar stranded 0.79 where main stranded 0.80.
    const outcome = simulateFleet({
      demandPerHour: 0,
      nowIso: NOW,
      router: "headroom",
      states: [plan({ alias: "a", hoursToReset: 1, utilization: 0.2 })],
      thresholds: { ...THRESHOLDS, spendOutAt: 0.99 },
      weeks: 1,
    });
    expect(outcome.weeks[0]!.strandedPlanWeeks).toBeCloseTo(0.8, 9);
  });

  it("records an early cap at the usage limit, and none when the limit is first reached in the last five hours", () => {
    const capsOf = ({ hoursToReset, utilization }: { hoursToReset: number; utilization: number }) =>
      simulate({
        demandPerHour: 0.02,
        nowIso: NOW,
        router: "least-used",
        states: [plan({ alias: "only", hoursToReset, usageLimitPercent: 50, utilization })],
        weeks: 1,
      }).weeks[0]!.earlyCaps;
    // 0.4 plus 0.02 an hour reaches 0.5 in the 04:00 hour, 96 hours early; the fresh week opening at 100 holds
    // 25 hours of 0.02, so it reaches 0.5 in the 124:00 hour, 144 hours before its own reset.
    expect(capsOf({ hoursToReset: 100, utilization: 0.4 })).toEqual([
      { alias: "only", atIso: at({ hours: 4 }), hoursBeforeReset: 96 },
      { alias: "only", atIso: at({ hours: 124 }), hoursBeforeReset: 144 },
    ]);
    // Reached in the 02:00 hour with 2 hours left: inside the last five, so only the fresh week's 28:00 cap counts.
    expect(capsOf({ hoursToReset: 4, utilization: 0.45 })).toEqual([
      { alias: "only", atIso: at({ hours: 28 }), hoursBeforeReset: 144 },
    ]);
  });

  it("lifts a 90% plan under an 80% house bar to its limit in its last hours, as routing does, and no further", () => {
    // 0.8 would be wrong here; `claudeEffectiveUsageCeiling` lifts the house bar and caps
    // it at the limit, and the forecast mirrors routing. 0.8 plus 0.001 an hour never reaches 0.9 before the reset.
    const run = simulateFleet({
      demandPerHour: 0.001,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 4, usageLimitPercent: 90, utilization: 0.8 })],
      thresholds: { ...THRESHOLDS, routeAt: 0.8 },
      weeks: 1,
    });
    expect(run.drySpells.filter((spell) => spell.startIso < at({ hours: 4 }))).toEqual([]);
  });

  it("still records an unlimited plan's cap in its last hours when the spend-out bar lifts nothing", () => {
    // With both bars at 0.95 main counted this cap, as it sat at the route bar.
    const { earlyCaps } = simulateFleet({
      demandPerHour: 0.02,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 4, utilization: 0.94 })],
      thresholds: { ...THRESHOLDS, spendOutAt: 0.95 },
      weeks: 1,
    }).weeks[0]!;
    expect(earlyCaps[0]).toEqual({ alias: "only", atIso: NOW, hoursBeforeReset: 4 });
  });

  it("records no cap on a plan a hair under its limit, which routing's exact comparison still admits", () => {
    // A 1e-9 tolerance capped 0.4999999995 of a 50% plan at once.
    const { earlyCaps } = simulateFleet({
      demandPerHour: 0,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 100, usageLimitPercent: 50, utilization: 0.4999999995 })],
      thresholds: THRESHOLDS,
      weeks: 1,
    }).weeks[0]!;
    expect(earlyCaps).toEqual([]);
  });

  it("spends a hair of room on a sliver of demand and then runs dry, never discarding the sliver as rounding", () => {
    // 1e-9 slices against 2e-9 of room were dropped and the hour read as not dry.
    const { drySpells } = simulate({
      demandPerHour: 12e-9,
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 100, usageLimitPercent: 50, utilization: 0.499999998 })],
      weeks: 1,
    });
    expect(drySpells[0]!.startIso).toBe(NOW);
  });
});

describe("breakEvenDemand", () => {
  it("finds the demand one fresh plan carries until its cap is reached, just short of the spend-out window", () => {
    const demand = breakEven({
      nowIso: NOW,
      router: "least-used",
      states: [plan({ alias: "only", hoursToReset: 168, utilization: 0 })],
      weeks: 1,
    });
    expect(demand).toBeCloseTo(0.95 / 163, 4);
  });

  it("carries less when the install's route bar is lower: 0.8 holds less than 0.95", () => {
    const states = [plan({ alias: "only", hoursToReset: 168, utilization: 0 })];
    const lowered = breakEvenDemand({
      nowIso: NOW,
      router: "least-used",
      states,
      thresholds: { ...THRESHOLDS, routeAt: 0.8 },
      weeks: 1,
    });
    expect(lowered).toBeCloseTo(0.8 / 163, 4);
  });

  it("carries a limited plan's share over the whole week, with no last-five-hours lift past the limit", () => {
    const demand = breakEven({
      nowIso: NOW,
      router: "headroom",
      states: [plan({ alias: "only", hoursToReset: 168, usageLimitPercent: 50, utilization: 0 })],
      weeks: 1,
    });
    expect(demand).toBeCloseTo(0.5 / 168, 5);
  });

  it("is zero when every plan already sits at its cap", () => {
    const demand = breakEven({
      nowIso: NOW,
      router: "headroom",
      states: [plan({ alias: "only", hoursToReset: 100, utilization: 0.95 })],
      weeks: 1,
    });
    expect(demand).toBe(0);
  });
});
