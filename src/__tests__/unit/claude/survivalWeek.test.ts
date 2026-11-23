/**
 * Where one plan's week stands at an instant (`currentWeekOf`): as read while its week is open, a fresh week placed
 * at a reset a FRESH reading's week has passed since, and a refusal for a stale reading or one taken after its own
 * reset. MEASURED: the weekly fleet-ceiling firing fell on a plan's own reset and read the whole ceiling
 * unmeasurable; `fleet ceiling` at that instant now reads 7 seats.
 */
import { describe, expect, it } from "vitest";
import type { DrawdownSample } from "../../../claude/drawdownAnomaly.js";
import {
  forecastSurvival,
  planStatesFromSamples,
  type SurvivalForecast,
  type SurvivalRead,
} from "../../../claude/survivalForecast.js";
import { currentWeekOf } from "../../../claude/survivalWeek.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const NOW = "2026-10-01T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const HOUR_MS = 3_600_000;

/** An instant `hours` from {@link NOW}, negative for the past. */
function at({ hours }: { hours: number }): string {
  return new Date(NOW_MS + hours * HOUR_MS).toISOString();
}

/** One journal sample, of plan `b` unless another alias is named. */
function sample({
  alias = "b",
  window = "seven-day",
  hours,
  resetHours,
  utilization,
}: {
  alias?: string;
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

/** Plan `b`'s week at {@link NOW}. */
const weekOf = ({ samples }: { samples: readonly DrawdownSample[] }): ReturnType<typeof currentWeekOf> =>
  currentWeekOf({ alias: "b", nowMs: NOW_MS, samples });

describe("currentWeekOf", () => {
  it("reads an open week as it was read", () => {
    expect(weekOf({ samples: [sample({ hours: -1, resetHours: 30, utilization: 0.5 })] })).toEqual({
      week: sample({ hours: -1, resetHours: 30, utilization: 0.5 }),
    });
  });

  it("places a fresh week at the reset a fresh reading's week has passed since", () => {
    expect(weekOf({ samples: [sample({ hours: -1, resetHours: -0.5, utilization: 0.9 })] })).toEqual({
      week: { observedAtIso: at({ hours: -0.5 }), resetAtIso: at({ hours: 167.5 }), utilization: 0 },
    });
  });

  it("places a fresh week when the instant IS the reset, the slot a weekly firing and a plan's reset share", () => {
    expect(weekOf({ samples: [sample({ hours: -0.1, resetHours: 0, utilization: 0.89 })] })).toEqual({
      week: { observedAtIso: NOW, resetAtIso: at({ hours: 168 }), utilization: 0 },
    });
  });

  it("places a reading exactly two hours old, the same bound an open week is held to", () => {
    expect(weekOf({ samples: [sample({ hours: -2, resetHours: -1, utilization: 0.9 })] })).toEqual({
      week: { observedAtIso: at({ hours: -1 }), resetAtIso: at({ hours: 167 }), utilization: 0 },
    });
  });

  it("refuses a reset-passed reading over two hours old", () => {
    expect(weekOf({ samples: [sample({ hours: -3, resetHours: -0.5, utilization: 0.9 })] })).toEqual({
      because:
        "b's newest seven-day sample is from 2026-09-30T21:00Z, over two hours old — " +
        "the watch has stopped reading that plan, so where it stands now is unknown",
    });
  });

  it("refuses a reading taken after its own reset, never inferring a week from it", () => {
    expect(weekOf({ samples: [sample({ hours: -0.25, resetHours: -0.5, utilization: 0.9 })] })).toEqual({
      because:
        "b's newest seven-day sample was read after its own reset at 2026-09-30T23:30Z, so where its new week stands is unknown",
    });
  });

  it("lets the newest reading decide: an older sample naming a later reset never masks a week that reset since", () => {
    const samples = [
      sample({ hours: -1.5, resetHours: 10, utilization: 0.4 }),
      sample({ hours: -1, resetHours: -0.5, utilization: 0.9 }),
    ];
    expect(weekOf({ samples })).toEqual({
      week: { observedAtIso: at({ hours: -0.5 }), resetAtIso: at({ hours: 167.5 }), utilization: 0 },
    });
  });

  it("still reads the newest open week when a newer reading came after its own reset", () => {
    const samples = [
      sample({ hours: -1.5, resetHours: 10, utilization: 0.4 }),
      sample({ hours: -0.25, resetHours: -0.5, utilization: 0.9 }),
    ];
    expect(weekOf({ samples })).toEqual({ week: sample({ hours: -1.5, resetHours: 10, utilization: 0.4 }) });
  });

  it("refuses a plan the journal never read", () => {
    expect(weekOf({ samples: [] })).toEqual({
      because: "b has no seven-day sample whose reset is still ahead, so where it stands is unknown",
    });
  });
});

describe("planStatesFromSamples over a rolled week", () => {
  it("places the rolled week and leaves a reset-passed fable window unread rather than rolling it", () => {
    const placed = planStatesFromSamples({
      nowIso: NOW,
      plans: [{ alias: "b", usageLimitPercent: 100 }],
      samples: [
        sample({ hours: -1, resetHours: -0.5, utilization: 0.9 }),
        sample({ hours: -1, resetHours: -0.5, utilization: 0.4, window: "fable-seven-day" }),
      ],
      thresholds: DEFAULT_THRESHOLDS.claude,
    });
    expect(placed).toEqual({
      states: [
        {
          absorbPerHour: undefined,
          alias: "b",
          fableResetAtIso: undefined,
          fableUtilization: undefined,
          observedAtIso: at({ hours: -0.5 }),
          resetAtIso: at({ hours: 167.5 }),
          usageLimitPercent: 100,
          utilization: 0,
        },
      ],
    });
  });
});

/** The forecast a read carries, throwing with its reason when it carries none. */
function forecastOf({ read }: { read: SurvivalRead }): SurvivalForecast {
  if (read.kind !== "forecast") {
    throw new Error(`expected a forecast, got: ${read.because}`);
  }
  return read.forecast;
}

describe("forecastSurvival over a rolled week", () => {
  it("forecasts from a plan whose week reset at its instant, starting that plan at a fresh week", () => {
    const freshA = [-5, -4, -3, -2, -1].map((hours) =>
      sample({ alias: "a", hours, resetHours: 30, utilization: 0.5 + (hours + 5) * 0.1 }),
    );
    const read = forecastSurvival({
      demandBasis: "trailing",
      nowIso: NOW,
      plans: ["a", "b"].map((alias) => ({ alias, paused: undefined, usageLimitPercent: 100 as const })),
      samples: [...freshA, sample({ hours: -0.1, resetHours: 0, utilization: 0.89 })],
      thresholds: DEFAULT_THRESHOLDS.claude,
      weeks: 1,
    });
    const forecast = forecastOf({ read });
    expect(forecast.states.map(({ alias, resetAtIso, utilization }) => ({ alias, resetAtIso, utilization }))).toEqual([
      { alias: "a", resetAtIso: at({ hours: 30 }), utilization: 0.9 },
      { alias: "b", resetAtIso: at({ hours: 168 }), utilization: 0 },
    ]);
    expect(forecast.simulations.length).toBeGreaterThan(0);
  });
});
