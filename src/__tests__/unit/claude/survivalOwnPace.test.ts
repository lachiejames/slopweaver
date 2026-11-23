/**
 * Each plan run forward at its own cycle rate, alone: where it would wall, and whether that lands before its
 * reset. The wall is the plan's usage limit, so a plan the owner held to half is judged against half.
 */
import { describe, expect, it } from "vitest";
import { ownPaceProjection } from "../../../claude/survivalOwnPace.js";

const NOW = "2026-10-01T00:00:00.000Z";
const HOUR_MS = 3_600_000;

/** An instant `hours` from {@link NOW}, negative for the past. */
function at({ hours }: { hours: number }): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

describe("ownPaceProjection", () => {
  const base = {
    absorbPerHour: undefined,
    alias: "a",
    observedAtIso: NOW,
    resetAtIso: at({ hours: 84 }),
  };

  it("runs a plan forward at its own cycle rate and says it walls before the reset", () => {
    const lines = ownPaceProjection({
      nowIso: NOW,
      state: {
        ...base,
        fableResetAtIso: undefined,
        fableUtilization: undefined,
        usageLimitPercent: 100,
        utilization: 0.75,
      },
    });
    // 0.75 in the 84 hours since the week opened; the last 0.25 takes 28 hours at that rate.
    expect(lines).toEqual([
      {
        alias: "a",
        capsBeforeReset: true,
        resetAtIso: at({ hours: 84 }),
        utilization: 0.75,
        wallAtIso: at({ hours: 28 }),
        window: "seven-day",
      },
    ]);
  });

  it("walls a plan at its usage limit, where the whole plan on the same pace would not wall at all", () => {
    const state = {
      ...base,
      fableResetAtIso: undefined,
      fableUtilization: undefined,
      utilization: 0.375,
    } as const;
    // 0.375 in the 84 hours since the week opened: the next 0.125 takes 28 hours, the next 0.625 takes 140.
    expect(ownPaceProjection({ nowIso: NOW, state: { ...state, usageLimitPercent: 50 } })).toEqual([
      {
        alias: "a",
        capsBeforeReset: true,
        resetAtIso: at({ hours: 84 }),
        utilization: 0.375,
        wallAtIso: at({ hours: 28 }),
        window: "seven-day",
      },
    ]);
    expect(ownPaceProjection({ nowIso: NOW, state: { ...state, usageLimitPercent: 100 } })).toEqual([
      {
        alias: "a",
        capsBeforeReset: false,
        resetAtIso: at({ hours: 84 }),
        utilization: 0.375,
        wallAtIso: at({ hours: 140 }),
        window: "seven-day",
      },
    ]);
  });

  it("calls a plan already at its usage limit walled now", () => {
    const lines = ownPaceProjection({
      nowIso: NOW,
      state: {
        ...base,
        fableResetAtIso: undefined,
        fableUtilization: undefined,
        usageLimitPercent: 50,
        utilization: 0.5,
      },
    });
    expect(lines).toEqual([
      {
        alias: "a",
        capsBeforeReset: true,
        resetAtIso: at({ hours: 84 }),
        utilization: 0.5,
        wallAtIso: NOW,
        window: "seven-day",
      },
    ]);
  });

  it("projects the Fable week too when one was read, and a plan on exact pace does not wall early", () => {
    const lines = ownPaceProjection({
      nowIso: NOW,
      state: {
        ...base,
        fableResetAtIso: at({ hours: 84 }),
        fableUtilization: 0.5,
        usageLimitPercent: 100,
        utilization: 0,
      },
    });
    expect(lines).toEqual([
      {
        alias: "a",
        capsBeforeReset: false,
        resetAtIso: at({ hours: 84 }),
        utilization: 0,
        wallAtIso: undefined,
        window: "seven-day",
      },
      {
        alias: "a",
        capsBeforeReset: false,
        resetAtIso: at({ hours: 84 }),
        utilization: 0.5,
        wallAtIso: at({ hours: 84 }),
        window: "fable-seven-day",
      },
    ]);
  });
});
