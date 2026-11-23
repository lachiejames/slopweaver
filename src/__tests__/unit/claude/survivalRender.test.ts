/**
 * The historical trend's text: every line conditional on the measured burn repeating, capacity counted to each
 * plan's usage limit, and which router the owner is told would do better, and on what grounds.
 */
import { describe, expect, it } from "vitest";
import type { SurvivalForecast } from "../../../claude/survivalForecast.js";
import { compareRouters, renderSurvivalForecast, survivalVerdict } from "../../../claude/survivalRender.js";
import type { SimulationOutcome } from "../../../claude/survivalSimulate.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

/** A one-week simulation with the given totals. */
function simulation({
  router,
  dry,
  stranded,
  earlyCapHours,
}: {
  router: SimulationOutcome["router"];
  dry: number;
  stranded: number;
  earlyCapHours: number;
}): SimulationOutcome {
  return {
    drySpells: [],
    router,
    weeks: [
      {
        dryHours: dry,
        earlyCaps:
          earlyCapHours === 0
            ? []
            : [{ alias: "a", atIso: "2026-10-01T00:00:00.000Z", hoursBeforeReset: earlyCapHours }],
        strandedPlanWeeks: stranded,
        unmetPlanWeeks: 0,
        weekStartIso: "2026-10-01T00:00:00.000Z",
      },
    ],
  };
}

/** A forecast carrying only what the verdict reads. */
function forecastOf({ simulations }: { simulations: readonly SimulationOutcome[] }): SurvivalForecast {
  return {
    aliases: [],
    basis: "historical trend",
    breakEven: [],
    demand: {
      censoredHours: 0,
      fromIso: "2026-09-24T00:00:00.000Z",
      peakDay: undefined,
      peakPlanWeeksPerHour: 0,
      planWeeksPerHour: 0,
      toIso: "2026-10-01T00:00:00.000Z",
    },
    demandBasis: "trailing",
    nowIso: "2026-10-01T00:00:00.000Z",
    ownPace: [],
    paused: [],
    resumeScenarios: [],
    simulations,
    states: [],
    thresholds: THRESHOLDS,
    weeks: 1,
  };
}

describe("renderSurvivalForecast", () => {
  const quiet = simulation({ dry: 0, earlyCapHours: 0, router: "headroom", stranded: 0 });
  const state = {
    absorbPerHour: undefined,
    fableResetAtIso: undefined,
    fableUtilization: undefined,
    observedAtIso: "2026-10-01T00:00:00.000Z",
    resetAtIso: "2026-10-03T00:00:00.000Z",
    usageLimitPercent: 100,
    utilization: 0.5,
  } as const;
  const forecast: SurvivalForecast = {
    ...forecastOf({ simulations: [quiet] }),
    aliases: ["plan-one", "plan-two", "plan-three"],
    breakEven: [{ planWeeksPerHour: 0.01, router: "headroom" }],
    paused: [
      {
        alias: "plan-two",
        placement: "rolled",
        reason: "a bounced charge",
        sinceIso: "2026-09-21T11:00:00.000Z",
        state: { ...state, alias: "plan-two", observedAtIso: "2026-09-19T10:00:00.000Z", utilization: 0 },
        usageLimitPercent: 100,
      },
      {
        alias: "plan-three",
        placement: "unread",
        reason: "awaiting approval",
        sinceIso: "2026-09-25T00:00:00.000Z",
        state: undefined,
        usageLimitPercent: 100,
      },
    ],
    resumeScenarios: [{ alias: "plan-two", simulation: quiet }],
    states: [{ ...state, alias: "plan-one" }],
  };

  it("counts configured, spendable and paused plans apart, and capacity from the spendable ones only", () => {
    const lines = renderSurvivalForecast({ forecast });
    expect(lines[0]).toBe(
      "claude historical trend at 2026-10-01T00:00Z: 3 plans configured, 1 spendable, 2 paused; 1 weeks, trailing demand",
    );
    expect(lines[1]).toBe(
      "demand 0.00/day over 2026-09-24 → 2026-10-01, no whole day in the window; the spendable plans hold 0.14/day at the 95% cap",
    );
  });

  it("names the forecast's own route bar as the cap, not a fixed 95%", () => {
    const lines = renderSurvivalForecast({ forecast: { ...forecast, thresholds: { ...THRESHOLDS, routeAt: 0.85 } } });
    expect(lines[1]).toBe(
      "demand 0.00/day over 2026-09-24 → 2026-10-01, no whole day in the window; the spendable plans hold 0.12/day at the 85% cap",
    );
  });

  it("counts a limited plan's capacity to its usage limit, never the route bar above it", () => {
    // One plan held to 50%: 0.5 of a week over 168 hours is 0.07 of a plan-week a day, where 95% would be 0.14.
    const limited = { ...forecast, states: [{ ...state, alias: "plan-one", usageLimitPercent: 50 as const }] };
    expect(renderSurvivalForecast({ forecast: limited })[1]).toBe(
      "demand 0.00/day over 2026-09-24 → 2026-10-01, no whole day in the window; the spendable plans hold 0.07/day " +
        "at the 95% cap or each plan's usage limit where lower",
    );
  });

  it("lists every paused plan, its estimate labelled and an unread one's reset never invented", () => {
    const lines = renderSurvivalForecast({ forecast });
    const from = lines.indexOf("paused, not spent by any router above:");
    expect(lines.slice(from, from + 3)).toEqual([
      "paused, not spent by any router above:",
      "  plan-two    PAUSED since 2026-09-21 — a bounced charge; week 0% (estimated: last read 2026-09-19T10:00Z, " +
        "reset since), resets 2026-10-03T00:00Z; resumed alone, the historical trend would leave 0 dry hours",
      "  plan-three  PAUSED since 2026-09-25 — awaiting approval; never read by the watch, so its week and reset are unread",
    ]);
  });

  it("names a paused plan whose every read was dropped as misread, rather than calling it never read", () => {
    const misread = { ...forecast.paused[1]!, placement: "misread" as const };
    const lines = renderSurvivalForecast({ forecast: { ...forecast, paused: [forecast.paused[0]!, misread] } });
    const from = lines.indexOf("paused, not spent by any router above:");
    expect(lines[from + 2]).toBe(
      "  plan-three  PAUSED since 2026-09-25 — awaiting approval; every weekly reading shared another plan's reset, " +
        "dropped as misread, so its week and reset are unread",
    );
  });
});

describe("compareRouters", () => {
  const base = { dry: 0, earlyCapHours: 0, router: "headroom" as const, stranded: 0 };

  it("ranks fewer dry hours first, whatever else differs", () => {
    expect(compareRouters({ left: { ...base, dry: 1 }, right: { ...base, earlyCapHours: 500, stranded: 3 } })).toBe(1);
  });

  it("treats a stranded difference under 0.05 plan-weeks as noise and falls through to early-cap hours", () => {
    expect(
      compareRouters({
        left: { ...base, earlyCapHours: 10, stranded: 0.04 },
        right: { ...base, earlyCapHours: 30, stranded: 0 },
      }),
    ).toBe(-20);
  });
});

describe("survivalVerdict", () => {
  it("names a router that beats today's headroom router, with both sides' numbers, as the fleet's to fix", () => {
    const lines = survivalVerdict({
      forecast: forecastOf({
        simulations: [
          simulation({ dry: 0, earlyCapHours: 47, router: "headroom", stranded: 1.38 }),
          simulation({ dry: 0, earlyCapHours: 400, router: "earliest-reset", stranded: 0 }),
          simulation({ dry: 0, earlyCapHours: 277, router: "least-used", stranded: 0 }),
        ],
      }),
    });
    expect(lines).toEqual([
      "verdict, historical trend: the fleet would survive 1 week(s) at trailing demand under today's router.",
      "routing: least-used would leave 0 dry hours, 0.00 plan-weeks stranded, 277 plan-hours capped early; today's would leave " +
        "0 dry hours, 1.38 plan-weeks stranded, 47 plan-hours capped early — today's ranking has drifted from the owner's " +
        "balance desires, so `rankClaudePlans` is the fleet's to fix.",
    ]);
  });

  it("says no other router does better when today's is best", () => {
    const lines = survivalVerdict({
      forecast: forecastOf({
        simulations: [
          simulation({ dry: 0, earlyCapHours: 0, router: "headroom", stranded: 0 }),
          simulation({ dry: 2, earlyCapHours: 0, router: "least-used", stranded: 0 }),
        ],
      }),
    });
    expect(lines).toEqual([
      "verdict, historical trend: the fleet would survive 1 week(s) at trailing demand under today's router; no other router does better.",
    ]);
  });
});
