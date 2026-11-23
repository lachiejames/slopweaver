/*
 * `measureFleetCeiling` — the burn per working seat-hour: every plan's draw over the working seat-hours, only over
 * stretches a tick covers and every plan's readings bracket, dropping a gapped, reset or falling stretch, and
 * unmeasurable rather than an infinite or zero burn. Every figure is worked out by hand in the test that asserts it.
 */
import { describe, expect, it } from "vitest";
import type { DrawdownSample } from "../../../../claude/drawdownAnomaly.js";
import { unwrap } from "../../../../lib/result.js";
import {
  ALPHA_RUN,
  BETA_RUN,
  FAR_RESET,
  HOUR_FROM,
  HOUR_TO,
  measureFleetCeiling,
  run,
  sample,
  THREE_WORKING,
  tick,
  weekly,
} from "../seatCeilingFixtures.js";

describe("measureFleetCeiling — burn per working seat-hour", () => {
  it("divides every plan's draw by the working seat-hours over unequal tick intervals", () => {
    // 00:00 w2 holds 30m, 00:30 w4 holds to 01:00: 1 + 2 = 3 working seat-hours. Drawn 0.12 + 0.06 = 0.18.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...ALPHA_RUN, ...BETA_RUN],
        ticks: [
          tick({ at: "2026-10-04T00:00:00.000Z", open: 5, working: 2 }),
          tick({ at: "2026-10-04T00:30:00.000Z", open: 5, working: 4 }),
        ],
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "measured",
      overlapHours: 1,
      planWeeksDrawn: expect.closeTo(0.18, 12),
      planWeeksPerWorkingSeatHour: expect.closeTo(0.06, 12),
      workingSeatHours: 3,
    });
  });

  it("counts only the stretches a tick covers", () => {
    // One tick at 00:30 holds to 01:00: 1.5 working seat-hours, alpha 0.06 + beta 0.03 drawn.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...ALPHA_RUN, ...BETA_RUN],
        ticks: [tick({ at: "2026-10-04T00:30:00.000Z", open: 5, working: 3 })],
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "measured",
      overlapHours: 0.5,
      planWeeksDrawn: expect.closeTo(0.09, 12),
      planWeeksPerWorkingSeatHour: expect.closeTo(0.06, 12),
      workingSeatHours: 1.5,
    });
  });

  it("drops a stretch where samples sit more than ten minutes apart, for every plan at once", () => {
    // alpha skips 00:20, so 00:10 → 00:30 is twenty minutes and no interval: 00:10–00:30 counts for nobody.
    // 40 minutes remain: alpha 0.02 + 0.06, beta 0.01 + 0.03 = 0.12 over 3 × 40/60 = 2 seat-hours.
    const gapped = ALPHA_RUN.filter((reading) => reading.observedAtIso !== "2026-10-04T00:20:00.000Z");
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...gapped, ...BETA_RUN],
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "measured",
      overlapHours: expect.closeTo(40 / 60, 12),
      planWeeksDrawn: expect.closeTo(0.12, 12),
      planWeeksPerWorkingSeatHour: expect.closeTo(0.06, 12),
      workingSeatHours: 2,
    });
  });

  it("drops the stretch across a reset, where the reading falls to a new window", () => {
    // alpha resets at 00:25: 00:20 (0.94, old reset) → 00:30 (0.01, new reset) is no interval.
    // 50 minutes remain: alpha 0.04 + 0.06, beta 0.02 + 0.03 = 0.15 over 3 × 50/60 = 2.5 seat-hours.
    const oldReset = "2026-10-04T00:25:00.000Z";
    const newReset = "2026-10-11T00:25:00.000Z";
    const alpha = [
      ...run({ alias: "alpha", resetAtIso: oldReset, startIso: HOUR_FROM, utilizations: [0.9, 0.92, 0.94] }),
      ...run({
        alias: "alpha",
        resetAtIso: newReset,
        startIso: "2026-10-04T00:30:00.000Z",
        utilizations: [0.01, 0.03, 0.05, 0.07],
      }),
    ];
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...alpha, ...BETA_RUN],
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "measured",
      overlapHours: expect.closeTo(50 / 60, 12),
      planWeeksDrawn: expect.closeTo(0.15, 12),
      planWeeksPerWorkingSeatHour: expect.closeTo(0.06, 12),
      workingSeatHours: 2.5,
    });
  });

  it("drops a stretch whose reading falls inside one window", () => {
    // alpha dips 0.12 → 0.11 over 00:10–00:20, so that stretch is no interval. 50 minutes remain:
    // alpha 0.02 + 0.05 + 0.06 = 0.13, beta 0.06 − 0.01 = 0.05; 0.18 over 2.5 seat-hours.
    const alpha = run({
      alias: "alpha",
      resetAtIso: FAR_RESET,
      startIso: HOUR_FROM,
      utilizations: [0.1, 0.12, 0.11, 0.16, 0.18, 0.2, 0.22],
    });
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...alpha, ...BETA_RUN],
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "measured",
      overlapHours: expect.closeTo(50 / 60, 12),
      planWeeksDrawn: expect.closeTo(0.18, 12),
      planWeeksPerWorkingSeatHour: expect.closeTo(0.072, 12),
      workingSeatHours: 2.5,
    });
  });

  it("is unmeasurable with no working seat-hours, never an infinite or zero burn", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...ALPHA_RUN, ...BETA_RUN],
        ticks: [tick({ at: HOUR_FROM, open: 12, working: 0 })],
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "unmeasurable",
      reason: "no seat was working while the plans were being read",
    });
    expect(report.ceiling).toEqual({
      kind: "unmeasurable",
      reason: "the burn per working seat is unknown because no seat was working while the plans were being read",
    });
  });

  it("is unmeasurable when a plan has no run of weekly readings, naming the plan", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: ALPHA_RUN,
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "unmeasurable",
      reason: "beta has no run of weekly readings in the span, so the plans' draw cannot be summed",
    });
  });

  it("is unmeasurable when no tick overlaps the plans' readings", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha", "beta"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...ALPHA_RUN, ...BETA_RUN],
        ticks: [tick({ at: "2026-10-03T22:00:00.000Z", open: 5, working: 3 })],
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "unmeasurable",
      reason: "no stretch of the span had a supervisor tick and every plan's weekly readings at once",
    });
  });

  it("is unmeasurable when the plans drew nothing while seats worked", () => {
    const flat = run({
      alias: "alpha",
      resetAtIso: FAR_RESET,
      startIso: HOUR_FROM,
      utilizations: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
    });
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly("alpha"),
        fromIso: HOUR_FROM,
        problems: [],
        samples: flat,
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({
      kind: "unmeasurable",
      reason: "the plans drew nothing measurable while seats were working",
    });
  });

  it("never reads a reading after the span's end into the burn", () => {
    // alpha draws 0.1 from 00:00 to 00:50 under three working seats: 0.1 / 2.5 seat-hours = 0.04. The 01:05
    // reading at 0.4 would, interpolated across 00:50–01:00, nearly double it while the ceiling reads 0.2.
    const inSpan = run({
      alias: "alpha",
      resetAtIso: FAR_RESET,
      startIso: HOUR_FROM,
      utilizations: [0.1, 0.12, 0.14, 0.16, 0.18, 0.2],
    });
    const afterEnd = sample({
      alias: "alpha",
      observedAtIso: "2026-10-04T01:05:00.000Z",
      resetAtIso: FAR_RESET,
      utilization: 0.4,
    });
    const measure = ({ samples }: { samples: readonly DrawdownSample[] }) =>
      unwrap(
        measureFleetCeiling({
          plans: weekly("alpha"),
          fromIso: HOUR_FROM,
          problems: [],
          samples,
          ticks: THREE_WORKING,
          toIso: HOUR_TO,
        }),
      );
    const withAfter = measure({ samples: [...inSpan, afterEnd] });
    expect(withAfter.burn).toEqual(measure({ samples: inSpan }).burn);
    expect(withAfter.burn).toEqual({
      kind: "measured",
      overlapHours: expect.closeTo(50 / 60, 12),
      planWeeksDrawn: expect.closeTo(0.1, 12),
      planWeeksPerWorkingSeatHour: expect.closeTo(0.04, 12),
      workingSeatHours: expect.closeTo(2.5, 12),
    });
  });

  it("is unmeasurable with no unpaused plan configured", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly(),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [...ALPHA_RUN, ...BETA_RUN],
        ticks: THREE_WORKING,
        toIso: HOUR_TO,
      }),
    );
    expect(report.burn).toEqual({ kind: "unmeasurable", reason: "no unpaused Claude plan is configured" });
  });
});
