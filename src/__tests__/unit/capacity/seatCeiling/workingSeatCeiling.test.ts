/*
 * `measureFleetCeiling` — the working-seat ceiling: the floor of the plans' summed headroom per hour over the burn,
 * each plan judged on its latest reading by instant, a cap lifted to 1.0 in a week's last five hours, a plan past
 * its cap counted as no headroom, and unmeasurable on a burn too small to divide by or a stale journal. Every figure
 * is worked out by hand in the test that asserts it.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../lib/result.js";
import {
  ceilingFixture,
  FAR_RESET,
  HOUR_FROM,
  HOUR_TO,
  measureFleetCeiling,
  run,
  sample,
  THREE_WORKING,
  weekly,
} from "../seatCeilingFixtures.js";

describe("measureFleetCeiling — the working-seat ceiling", () => {
  it("judges each plan on its latest reading by instant, however the reading's offset is spelled", () => {
    // alpha's earlier reading is spelled with a +02:00 offset, which sorts after the later UTC reading as a string; the ceiling still reads the later instant.
    const alphaReset = "2026-10-04T12:00:00.000Z";
    const samples = [
      ...run({
        alias: "alpha",
        resetAtIso: alphaReset,
        startIso: HOUR_FROM,
        utilizations: [0.444, 0.445, 0.446, 0.447, 0.448],
      }),
      sample({
        alias: "alpha",
        observedAtIso: "2026-10-04T02:50:00.000+02:00",
        resetAtIso: alphaReset,
        utilization: 0.449,
      }),
      sample({ alias: "alpha", observedAtIso: HOUR_TO, resetAtIso: alphaReset, utilization: 0.45 }),
      ...run({
        alias: "beta",
        resetAtIso: "2026-10-04T21:00:00.000Z",
        startIso: HOUR_FROM,
        utilizations: [0.747, 0.7475, 0.748, 0.7485, 0.749, 0.7495, 0.75],
      }),
    ];
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples,
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.ceiling).toEqual(
      expect.objectContaining({
        kind: "measured",
        plans: [
          expect.objectContaining({ observedAtIso: HOUR_TO, planAlias: "alpha", utilization: 0.45 }),
          expect.objectContaining({ observedAtIso: HOUR_TO, planAlias: "beta", utilization: 0.75 }),
        ],
        seats: 18,
      }),
    );
  });

  it("is the floor of the plans' summed headroom per hour over the burn", () => {
    // alpha (0.95 − 0.45) / 11h + beta (0.95 − 0.75) / 20h = 0.0454… + 0.01 = 0.0554…; ÷ 0.003 = 18.48 → 18.
    // A reading taken after the span's end (alpha at 0.9) is ignored, so a past instant replays exactly.
    const samples = [
      ...ceilingFixture({ alphaReset: "2026-10-04T12:00:00.000Z", betaReset: "2026-10-04T21:00:00.000Z" }),
      sample({
        alias: "alpha",
        observedAtIso: "2026-10-04T01:05:00.000Z",
        resetAtIso: "2026-10-04T12:00:00.000Z",
        utilization: 0.9,
      }),
    ];
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples,
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.ceiling).toEqual({
      burnPerWorkingSeatHour: expect.closeTo(0.003, 12),
      kind: "measured",
      plans: [
        {
          hoursToReset: 11,
          observedAtIso: HOUR_TO,
          planAlias: "alpha",
          resetAtIso: "2026-10-04T12:00:00.000Z",
          spendCap: 0.95,
          sustainablePlanWeeksPerHour: expect.closeTo(0.5 / 11, 12),
          utilization: 0.45,
        },
        {
          hoursToReset: 20,
          observedAtIso: HOUR_TO,
          planAlias: "beta",
          resetAtIso: "2026-10-04T21:00:00.000Z",
          spendCap: 0.95,
          sustainablePlanWeeksPerHour: expect.closeTo(0.01, 12),
          utilization: 0.75,
        },
      ],
      seats: 18,
      sustainablePlanWeeksPerHour: expect.closeTo(0.5 / 11 + 0.01, 12),
    });
  });

  it("lifts a plan's cap to 1.0 in its week's last five hours", () => {
    // alpha resets 4h out: (1 − 0.45) / 4 = 0.1375; + beta 0.01 = 0.1475; ÷ 0.003 = 49.17 → 49 (45 at 0.95).
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: ceilingFixture({ alphaReset: "2026-10-04T05:00:00.000Z", betaReset: "2026-10-04T21:00:00.000Z" }),
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.ceiling).toMatchObject({
      kind: "measured",
      plans: [
        { hoursToReset: 4, planAlias: "alpha", spendCap: 1 },
        { hoursToReset: 20, planAlias: "beta", spendCap: 0.95 },
      ],
      seats: 49,
    });
  });

  it("counts a plan already past its cap as no headroom, never negative", () => {
    // beta ends at 0.97, over its 0.95 cap: 0. alpha alone: 0.0454… ÷ 0.003 = 15.15 → 15.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: ceilingFixture({
          alphaReset: "2026-10-04T12:00:00.000Z",
          betaReset: "2026-10-04T21:00:00.000Z",
          betaUtilizations: [0.967, 0.9675, 0.968, 0.9685, 0.969, 0.9695, 0.97],
        }),
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.ceiling).toMatchObject({
      kind: "measured",
      plans: [{ planAlias: "alpha" }, { planAlias: "beta", sustainablePlanWeeksPerHour: 0, utilization: 0.97 }],
      seats: 15,
    });
  });

  it("is unmeasurable when the burn is so small the headroom divided by it is no number", () => {
    // 1e-320 plan-weeks over three seat-hours is a positive burn near 3e-321; alpha's ~0.01 an hour over it
    // overflows to Infinity, which is no seat count.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: run({
          alias: "alpha",
          resetAtIso: FAR_RESET,
          startIso: HOUR_FROM,
          utilizations: [0, 0, 0, 0, 0, 0, 1e-320],
        }),
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn.kind).toBe("measured");
    expect(report.ceiling).toEqual({
      kind: "unmeasurable",
      reason: "the burn per working seat is too small to divide the plans' headroom by",
    });
  });

  it("is unmeasurable when the newest reading is over two hours before the span's end", () => {
    // The burn is still measured over 00:00–01:00; the runway is not, because nothing was read after 01:00.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: ceilingFixture({ alphaReset: "2026-10-04T12:00:00.000Z", betaReset: "2026-10-04T21:00:00.000Z" }),
        ticks: THREE_WORKING,
        toIso: "2026-10-04T03:30:00.000Z",
      }),
    );
    expect(report.burn.kind).toBe("measured");
    expect(report.ceiling).toEqual({
      kind: "unmeasurable",
      reason:
        "the drawdown journal holds no sample from the last two hours — the gauge watch is not running, " +
        "so there is no current reading to forecast from (`slopweaver claude watch`)",
    });
  });
});
