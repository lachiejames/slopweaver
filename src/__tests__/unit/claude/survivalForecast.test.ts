/**
 * The survival trend's readings of the drawdown journal: what the fleet drew, and where each plan stands with its
 * usage limit. Each plan's own pace is `survivalOwnPace.test.ts`; the simulation itself is `survivalSimulate.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { DrawdownSample } from "../../../claude/drawdownAnomaly.js";
import { measureDemand, withoutMisreadSeries } from "../../../claude/survivalDemand.js";
import {
  forecastSurvival,
  planStatesFromSamples,
  type SurvivalForecast,
  type SurvivalRead,
} from "../../../claude/survivalForecast.js";
import type { SurvivalPlanInput, SurvivalPlanState } from "../../../claude/survivalPlanState.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { UsageLimitPercent } from "../../../plans/usageLimit.js";

const NOW = "2026-10-01T00:00:00.000Z";
const HOUR_MS = 3_600_000;
const WEEK_MS = 168 * HOUR_MS;
const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

/** Demand under the default thresholds, every alias an unlimited plan, which every case not about either is judged by. */
type MeasureArgs = Omit<Parameters<typeof measureDemand>[0], "thresholds" | "plans"> & { aliases: readonly string[] };
const UNLIMITED = { usageLimitPercent: 100 } as const;
const measure = ({ aliases, ...args }: MeasureArgs): ReturnType<typeof measureDemand> =>
  measureDemand({ ...args, plans: aliases.map((alias) => ({ alias, ...UNLIMITED })), thresholds: THRESHOLDS });

/** Plan placement under the default thresholds, every alias at one usage limit (the whole plan unless given). */
const placeStates = ({
  aliases,
  usageLimitPercent = 100,
  ...args
}: Omit<Parameters<typeof planStatesFromSamples>[0], "thresholds" | "plans"> & {
  aliases: readonly string[];
  usageLimitPercent?: UsageLimitPercent;
}): ReturnType<typeof planStatesFromSamples> =>
  planStatesFromSamples({
    ...args,
    plans: aliases.map((alias) => ({ alias, usageLimitPercent })),
    thresholds: THRESHOLDS,
  });

/** A forecast under the default thresholds. */
const runForecast = (args: Omit<Parameters<typeof forecastSurvival>[0], "thresholds">): SurvivalRead =>
  forecastSurvival({ ...args, thresholds: THRESHOLDS });

/** An instant `hours` from {@link NOW}, negative for the past. */
function at({ hours }: { hours: number }): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

/** One journal sample. */
function sample({
  alias,
  window = "seven-day",
  hours,
  resetHours,
  utilization,
}: {
  alias: string;
  window?: DrawdownSample["window"];
  hours: number;
  resetHours: number;
  utilization: number;
}): DrawdownSample {
  return {
    kind: "sample",
    observedAtIso: at({ hours }),
    planAlias: alias,
    resetAtIso: at({ hours: resetHours }),
    schemaVersion: 1,
    utilization,
    window,
  };
}

/** A placed plan's exact state with no Fable window, every field spelled, so a case's `toEqual` pins all of them. */
function placedState({
  absorbPerHour,
  alias,
  observedHours,
  resetHours,
  usageLimitPercent = 100,
  utilization,
}: {
  absorbPerHour?: number;
  alias: string;
  observedHours: number;
  resetHours: number;
  usageLimitPercent?: UsageLimitPercent;
  utilization: number;
}): SurvivalPlanState {
  const observedAtIso = at({ hours: observedHours });
  const resetAtIso = at({ hours: resetHours });
  const fable = { fableResetAtIso: undefined, fableUtilization: undefined };
  return { absorbPerHour, alias, ...fable, observedAtIso, resetAtIso, usageLimitPercent, utilization };
}

describe("measureDemand", () => {
  it("sums rising same-reset deltas across the window as plan-weeks per hour", () => {
    const demand = measure({
      aliases: ["a"],
      nowIso: NOW,
      samples: [
        sample({ alias: "a", hours: -30, resetHours: 50, utilization: 0.1 }),
        sample({ alias: "a", hours: -20, resetHours: 50, utilization: 0.3 }),
        sample({ alias: "a", hours: -10, resetHours: 50, utilization: 0.5 }),
      ],
      windowMs: WEEK_MS,
    });
    expect(demand.planWeeksPerHour).toBeCloseTo(0.4 / 168, 12);
    expect(demand.censoredHours).toBe(0);
  });

  it("adds a cycle's opening draw when the watch read it just after the reset, and never a mid-cycle first sight", () => {
    const demand = measure({
      aliases: ["a"],
      nowIso: NOW,
      samples: [
        // Opened at -20h, first read ten minutes later at 0.05: an opening draw.
        sample({ alias: "a", hours: -20 + 1 / 6, resetHours: 148, utilization: 0.05 }),
        sample({ alias: "a", hours: -10, resetHours: 148, utilization: 0.15 }),
        // Opened at -150h, first read at -100h already at 0.6: pre-watch draw, not an opening.
        sample({ alias: "a", hours: -100, resetHours: 18, utilization: 0.6 }),
      ],
      windowMs: WEEK_MS,
    });
    expect(demand.planWeeksPerHour).toBeCloseTo(0.15 / 168, 12);
  });

  it("counts an hour censored only when every plan read at its cap in it", () => {
    const demand = measure({
      aliases: ["a", "b"],
      nowIso: NOW,
      samples: [
        sample({ alias: "a", hours: -5, resetHours: 50, utilization: 0.96 }),
        sample({ alias: "b", hours: -5, resetHours: 60, utilization: 0.97 }),
        sample({ alias: "a", hours: -3, resetHours: 50, utilization: 0.96 }),
        sample({ alias: "b", hours: -3, resetHours: 60, utilization: 0.5 }),
      ],
      windowMs: WEEK_MS,
    });
    expect(demand.censoredHours).toBe(1);
  });

  it("judges a plan in its week's last five hours against the 1.0 cap, as a spawn would", () => {
    const demand = measure({
      aliases: ["a", "b"],
      nowIso: NOW,
      samples: [
        // a is three hours from its reset, so 0.97 still has room under the lifted cap.
        sample({ alias: "a", hours: -5, resetHours: -2, utilization: 0.97 }),
        sample({ alias: "b", hours: -5, resetHours: 60, utilization: 0.97 }),
      ],
      windowMs: WEEK_MS,
    });
    expect(demand.censoredHours).toBe(0);
  });

  it("names the heaviest whole UTC day as the peak, counting a cycle's opening draw in the day it fell", () => {
    const demand = measure({
      aliases: ["a"],
      nowIso: NOW,
      samples: [
        sample({ alias: "a", hours: -20, resetHours: 50, utilization: 0.1 }),
        sample({ alias: "a", hours: -16, resetHours: 50, utilization: 0.2 }),
        // Resets at +120h, so it opened at -48h and was first read half an hour later.
        sample({ alias: "b", hours: -47.5, resetHours: 120, utilization: 0.25 }),
      ],
      windowMs: WEEK_MS,
    });
    expect(demand.peakDay).toBe("2026-09-29");
    expect(demand.peakPlanWeeksPerHour).toBeCloseTo(0.25 / 24, 12);
  });

  it("names the heaviest whole UTC day as the peak", () => {
    const demand = measure({
      aliases: ["a"],
      nowIso: NOW,
      samples: [
        sample({ alias: "a", hours: -40, resetHours: 50, utilization: 0.1 }),
        sample({ alias: "a", hours: -36, resetHours: 50, utilization: 0.2 }),
        sample({ alias: "a", hours: -12, resetHours: 50, utilization: 0.5 }),
      ],
      windowMs: WEEK_MS,
    });
    expect(demand.peakDay).toBe("2026-09-30");
    expect(demand.peakPlanWeeksPerHour).toBeCloseTo(0.3 / 24, 12);
  });
});

describe("withoutMisreadSeries", () => {
  it("drops, in every window, what an alias read over the span it carried another account's reset", () => {
    const own = [
      sample({ alias: "one", hours: -30, resetHours: 50, utilization: 0.1 }),
      sample({ alias: "one", hours: -20, resetHours: 50, utilization: 0.2 }),
      sample({ alias: "one", hours: -10, resetHours: 50, utilization: 0.3 }),
      sample({ alias: "five", hours: -40, resetHours: 20, utilization: 0.6 }),
      sample({ alias: "five", hours: -5, resetHours: 20, utilization: 0.7 }),
    ];
    const misread = [
      sample({ alias: "five", hours: -20, resetHours: 50, utilization: 0.2 }),
      sample({ alias: "five", hours: -15, resetHours: 50, utilization: 0.25 }),
      sample({ alias: "five", hours: -18, resetHours: -16, utilization: 0.4, window: "five-hour" }),
    ];
    expect(withoutMisreadSeries({ samples: [...own, ...misread] })).toEqual(own);
  });

  it("keeps two aliases whose weeks reset at different instants", () => {
    const samples = [
      sample({ alias: "a", hours: -2, resetHours: 50, utilization: 0.1 }),
      sample({ alias: "b", hours: -2, resetHours: 51, utilization: 0.1 }),
    ];
    expect(withoutMisreadSeries({ samples })).toEqual(samples);
  });
});

describe("planStatesFromSamples", () => {
  it("starts each plan from its newest sample whose reset is still ahead, and its five-hour ceiling", () => {
    const placed = placeStates({
      aliases: ["a"],
      nowIso: NOW,
      samples: [
        sample({ alias: "a", hours: -2, resetHours: 30, utilization: 0.4 }),
        sample({ alias: "a", hours: -1, resetHours: 30, utilization: 0.5 }),
        // Read an hour after the window opened at -3h, so its 0 is an opening draw of nothing.
        sample({ alias: "a", hours: -2, resetHours: 2, utilization: 0, window: "five-hour" }),
        sample({ alias: "a", hours: -1, resetHours: 2, utilization: 0.5, window: "five-hour" }),
      ],
    });
    // A 0.5 five-hour rise moved the week 0.1, so one window is a fifth of a week: 0.95 * 0.2 / 5.
    const absorbPerHour = expect.closeTo((0.95 * 0.2) / 5, 12) as number;
    const a = placedState({ absorbPerHour, alias: "a", observedHours: -1, resetHours: 30, utilization: 0.5 });
    expect(placed).toEqual({ states: [a] });
  });

  it("carries each plan's usage limit off its register row into its state", () => {
    const placed = placeStates({
      aliases: ["a"],
      nowIso: NOW,
      samples: [sample({ alias: "a", hours: -1, resetHours: 30, utilization: 0.2 })],
      usageLimitPercent: 50,
    });
    const a = placedState({ alias: "a", observedHours: -1, resetHours: 30, usageLimitPercent: 50, utilization: 0.2 });
    expect(placed).toEqual({ states: [a] });
  });

  it("refuses a journal whose newest sample is older than two hours", () => {
    const placed = placeStates({
      aliases: ["a"],
      nowIso: NOW,
      samples: [sample({ alias: "a", hours: -3, resetHours: 30, utilization: 0.5 })],
    });
    expect(placed).toEqual({
      because:
        "the drawdown journal holds no sample from the last two hours — the gauge watch is not running, " +
        "so there is no current reading to forecast from (`slopweaver claude watch`)",
    });
  });

  it("measures no five-hour ceiling for a plan whose week has drawn nothing yet, never a ceiling of zero", () => {
    const placed = placeStates({
      aliases: ["b"],
      nowIso: NOW,
      samples: [
        // The week opened at -0.5h and still reads 0; the five-hour window moved 0.03 in the same span.
        sample({ alias: "b", hours: -0.25, resetHours: 167.5, utilization: 0 }),
        sample({ alias: "b", hours: -0.25, resetHours: 4.5, utilization: 0, window: "five-hour" }),
        sample({ alias: "b", hours: -0.1, resetHours: 4.5, utilization: 0.03, window: "five-hour" }),
      ],
    });
    const b = placedState({ alias: "b", observedHours: -0.25, resetHours: 167.5, utilization: 0 });
    expect(placed).toEqual({ states: [b] });
  });

  it("refuses a plan the watch stopped reading, even while another plan is fresh", () => {
    const placed = placeStates({
      aliases: ["a", "b"],
      nowIso: NOW,
      samples: [
        sample({ alias: "a", hours: -1, resetHours: 30, utilization: 0.5 }),
        sample({ alias: "b", hours: -3, resetHours: 40, utilization: 0.2 }),
      ],
    });
    expect(placed).toEqual({
      because:
        "b's newest seven-day sample is from 2026-09-30T21:00Z, over two hours old — " +
        "the watch has stopped reading that plan, so where it stands now is unknown",
    });
  });

  it("places a plan whose only fresh sample belongs to a week already reset at the week that opened since", () => {
    const placed = placeStates({
      aliases: ["a", "b"],
      nowIso: NOW,
      samples: [
        sample({ alias: "a", hours: -1, resetHours: 30, utilization: 0.5 }),
        sample({ alias: "b", hours: -1, resetHours: -0.5, utilization: 0.9 }),
      ],
    });
    // b's week reset at -0.5h, so it is read at that instant as the fresh, empty week that opened then.
    const a = placedState({ alias: "a", observedHours: -1, resetHours: 30, utilization: 0.5 });
    const b = placedState({ alias: "b", observedHours: -0.5, resetHours: 167.5, utilization: 0 });
    expect(placed).toEqual({ states: [a, b] });
  });
});

describe("forecastSurvival", () => {
  const live = ({ alias }: { alias: string }): SurvivalPlanInput => ({
    alias,
    paused: undefined,
    usageLimitPercent: 100,
  });
  const paused = ({
    alias,
    usageLimitPercent = 100,
  }: {
    alias: string;
    usageLimitPercent?: UsageLimitPercent;
  }): SurvivalPlanInput => ({
    alias,
    paused: { reason: "a bounced charge", sinceIso: at({ hours: -240 }) },
    usageLimitPercent,
  });
  /** Plan `a`, read fresh at 90% after drawing 0.1 of its week an hour, so alone it runs dry before its reset. */
  const freshA = [-5, -4, -3, -2, -1].map((hours) =>
    sample({ alias: "a", hours, resetHours: 30, utilization: 0.5 + (hours + 5) * 0.1 }),
  );

  it("is unmeasurable with no plan configured, and names every plan when all are paused", () => {
    expect(runForecast({ demandBasis: "trailing", nowIso: NOW, plans: [], samples: [], weeks: 4 })).toEqual({
      because: "no Claude plan is configured, so there is no fleet to forecast",
      kind: "unmeasurable",
    });
    expect(
      runForecast({
        demandBasis: "trailing",
        nowIso: NOW,
        plans: [paused({ alias: "a" }), paused({ alias: "b" })],
        samples: freshA,
        weeks: 4,
      }),
    ).toEqual({
      because: "every configured Claude plan is paused (a, b), so no seat can spend one",
      kind: "unmeasurable",
    });
  });

  it("carries the thresholds it judged under, and a lowered route bar lowers each plan's five-hour ceiling", () => {
    const input = {
      demandBasis: "trailing",
      nowIso: NOW,
      plans: [live({ alias: "a" })],
      samples: [
        sample({ alias: "a", hours: -2, resetHours: 30, utilization: 0.4 }),
        sample({ alias: "a", hours: -1, resetHours: 30, utilization: 0.5 }),
        sample({ alias: "a", hours: -2, resetHours: 2, utilization: 0, window: "five-hour" }),
        sample({ alias: "a", hours: -1, resetHours: 2, utilization: 0.5, window: "five-hour" }),
      ],
      weeks: 1,
    } as const;
    const lowered = forecastOf({ read: forecastSurvival({ ...input, thresholds: { ...THRESHOLDS, routeAt: 0.5 } }) });
    const standard = forecastOf({ read: runForecast(input) });
    expect(lowered.thresholds.routeAt).toBe(0.5);
    expect(standard.thresholds).toEqual(THRESHOLDS);
    expect(lowered.states[0]!.absorbPerHour).toBeCloseTo((0.5 * 0.2) / 5, 12);
    expect(standard.states[0]!.absorbPerHour).toBeCloseTo((0.95 * 0.2) / 5, 12);
  });

  it("ignores every sample after its instant, so a past instant replays exactly", () => {
    const read = runForecast({
      demandBasis: "trailing",
      nowIso: NOW,
      plans: [live({ alias: "a" })],
      samples: [
        sample({ alias: "a", hours: -1, resetHours: 30, utilization: 0.5 }),
        sample({ alias: "a", hours: 1, resetHours: 30, utilization: 0.9 }),
      ],
      weeks: 1,
    });
    expect(forecastOf({ read }).states[0]!.utilization).toBe(0.5);
  });

  it("still refuses a spendable plan with no current sample, whatever the paused ones hold", () => {
    expect(
      runForecast({
        demandBasis: "trailing",
        nowIso: NOW,
        plans: [live({ alias: "a" }), live({ alias: "b" })],
        samples: freshA,
        weeks: 1,
      }),
    ).toEqual({
      because: "b has no seven-day sample whose reset is still ahead, so where it stands is unknown",
      kind: "unmeasurable",
    });
  });

  it("lists every plan, places a paused one from its old sample, and never spends it", () => {
    const forecast = forecastOf({
      read: runForecast({
        demandBasis: "trailing",
        nowIso: NOW,
        plans: [paused({ alias: "b" }), live({ alias: "a" }), paused({ alias: "c" }), paused({ alias: "d" })],
        samples: [
          ...freshA,
          // b: read 300h ago, its week reset 250h ago — two weekly resets on it opens a fresh week 86h from now.
          sample({ alias: "b", hours: -300, resetHours: -250, utilization: 0.9 }),
          // c: read 10h ago, its week still open.
          sample({ alias: "c", hours: -10, resetHours: 50, utilization: 0.4 }),
        ],
        weeks: 1,
      }),
    });
    expect(forecast.aliases).toEqual(["b", "a", "c", "d"]);
    expect(forecast.states.map((state) => state.alias)).toEqual(["a"]);
    expect(
      forecast.paused.map((row) => [row.alias, row.placement, row.state?.resetAtIso, row.state?.utilization]),
    ).toEqual([
      ["b", "rolled", at({ hours: 86 }), 0],
      ["c", "observed", at({ hours: 50 }), 0.4],
      ["d", "unread", undefined, undefined],
    ]);
    expect(forecast.paused[0]!.state!.observedAtIso).toBe(at({ hours: -300 }));
  });

  it("calls a paused plan misread, never unread, when its only weekly read shared a live plan's reset", () => {
    const forecast = forecastOf({
      read: runForecast({
        demandBasis: "trailing",
        nowIso: NOW,
        plans: [live({ alias: "a" }), paused({ alias: "p" })],
        // One read on a's reset instant: a holds five there, so the misread filter drops p's one.
        samples: [...freshA, sample({ alias: "p", hours: -2, resetHours: 30, utilization: 0.4 })],
        weeks: 1,
      }),
    });
    expect(forecast.paused.map((row) => [row.alias, row.placement, row.state])).toEqual([["p", "misread", undefined]]);
    expect(forecast.resumeScenarios).toEqual([]);
  });

  it("places a paused plan from its newest sample by instant, where an offset-bearing timestamp sorts later as text", () => {
    // Text one hour ago, but +11:00 makes it twelve hours ago: older than the canonical sample two hours ago.
    const offsetOlder = {
      ...sample({ alias: "b", hours: 0, resetHours: 50, utilization: 0.2 }),
      observedAtIso: at({ hours: -1 }).replace(".000Z", ".000+11:00"),
    };
    const forecast = forecastOf({
      read: runForecast({
        demandBasis: "trailing",
        nowIso: NOW,
        plans: [live({ alias: "a" }), paused({ alias: "b" })],
        samples: [...freshA, offsetOlder, sample({ alias: "b", hours: -2, resetHours: 60, utilization: 0.8 })],
        weeks: 1,
      }),
    });
    expect([forecast.paused[0]!.state!.resetAtIso, forecast.paused[0]!.state!.utilization]).toEqual([
      at({ hours: 60 }),
      0.8,
    ]);
  });

  it("runs one today's-router scenario per placed paused plan, each with only that plan added", () => {
    const forecast = forecastOf({
      read: runForecast({
        demandBasis: "trailing",
        nowIso: NOW,
        plans: [live({ alias: "a" }), paused({ alias: "b" }), paused({ alias: "d" })],
        samples: [...freshA, sample({ alias: "b", hours: -300, resetHours: -250, utilization: 0.9 })],
        weeks: 1,
      }),
    });
    expect(forecast.resumeScenarios.map((scenario) => [scenario.alias, scenario.simulation.router])).toEqual([
      ["b", "headroom"],
    ]);
    const today = forecast.simulations.find((simulation) => simulation.router === "headroom")!;
    const resumed = forecast.resumeScenarios[0]!.simulation;
    const dry = ({ of }: { of: typeof today }): number => of.weeks.reduce((sum, week) => sum + week.dryHours, 0);
    expect(dry({ of: today })).toBeGreaterThan(0);
    expect(dry({ of: resumed })).toBeLessThan(dry({ of: today }));
  });

  it("says it is a historical trend, never a fact", () => {
    const read = runForecast({
      demandBasis: "trailing",
      nowIso: NOW,
      plans: [live({ alias: "a" })],
      samples: freshA,
      weeks: 1,
    });
    expect(forecastOf({ read }).basis).toBe("historical trend");
  });

  it("holds a paused plan's resume scenario to that plan's own usage limit", () => {
    const resumedWith = ({ usageLimitPercent }: { usageLimitPercent: UsageLimitPercent }): SurvivalForecast =>
      forecastOf({
        read: runForecast({
          demandBasis: "trailing",
          nowIso: NOW,
          plans: [live({ alias: "a" }), paused({ alias: "b", usageLimitPercent })],
          samples: [...freshA, sample({ alias: "b", hours: -300, resetHours: -250, utilization: 0.9 })],
          weeks: 1,
        }),
      });
    const half = resumedWith({ usageLimitPercent: 50 });
    const whole = resumedWith({ usageLimitPercent: 100 });
    const stranded = ({ of }: { of: SurvivalForecast }): number =>
      of.resumeScenarios[0]!.simulation.weeks[0]!.strandedPlanWeeks;
    expect(half.paused[0]!.state!.usageLimitPercent).toBe(50);
    expect(whole.paused[0]!.state!.usageLimitPercent).toBe(100);
    // b opens a fresh week 86h in and spends little of it before its reset; the share above 50% was never the
    // fleet's, so it is not counted unspent — nearly half a plan-week less than the same plan held to nothing.
    expect(stranded({ of: whole }) - stranded({ of: half })).toBeGreaterThan(0.45);
    expect(stranded({ of: whole }) - stranded({ of: half })).toBeLessThan(0.5);
  });

  it("keeps a paused plan's draw this week in demand, since the seats that drew it still need carrying", () => {
    const pausedDraw = [-20, -15, -10].map((hours) =>
      sample({ alias: "b", hours, resetHours: 100, utilization: 0.3 + (hours + 20) * 0.05 }),
    );
    const demandWith = ({ samples }: { samples: readonly DrawdownSample[] }): number =>
      forecastOf({
        read: runForecast({
          demandBasis: "trailing",
          nowIso: NOW,
          plans: [live({ alias: "a" }), paused({ alias: "b" })],
          samples,
          weeks: 1,
        }),
      }).demand.planWeeksPerHour;
    // b drew 0.5 of a week this window, so demand rises by 0.5 plan-weeks over the window's 168 hours.
    expect(demandWith({ samples: [...freshA, ...pausedDraw] }) - demandWith({ samples: freshA })).toBeCloseTo(
      0.5 / 168,
      12,
    );
  });
});

/** The forecast inside a read, throwing when there is none so the assertion itself carries no branch. */
function forecastOf({ read }: { read: SurvivalRead }): SurvivalForecast {
  if (read.kind !== "forecast") {
    throw new Error(`expected a forecast, got: ${read.because}`);
  }
  return read.forecast;
}
