/**
 * The plan-drawdown detector.
 *
 * Two of these tests are the whole reason the module exists rather than a token-spend threshold: the one
 * proving a rate is never computed across a reset, and the one proving a young baseline refuses to fire.
 * A detector that got either wrong would either scream every five hours or never speak at all.
 */
import { describe, expect, it } from "vitest";
import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import {
  DEFAULT_DRAWDOWN_POLICY,
  type DrawdownSample,
  drawdownBaseline,
  drawdownRates,
  drawdownSamples,
  evaluateDrawdown,
  renderDrawdownEvaluation,
} from "../../../claude/drawdownAnomaly.js";

/** One five-hour sample, spelled out so every rate below is arithmetic a reader can redo. */
function sample({
  minutes,
  utilization,
  resetAtIso = "2026-09-10T18:00:00.000Z",
  planAlias = "plan-a",
  window = "five-hour" as const,
}: {
  minutes: number;
  utilization: number;
  resetAtIso?: string;
  planAlias?: string;
  window?: "five-hour" | "seven-day" | "fable-seven-day";
}): DrawdownSample {
  return {
    kind: "sample",
    observedAtIso: new Date(Date.UTC(2026, 8, 10, 12, minutes, 0)).toISOString(),
    planAlias,
    resetAtIso,
    schemaVersion: 1,
    utilization,
    window,
  };
}

describe("drawdownSamples", () => {
  const gauge: ClaudeAccountGauge = {
    alias: "plan-a",
    fiveHour: { resetAtIso: "2026-09-10T18:00:00.000Z", status: "allowed", utilization: 0.2 },
    observedAtIso: "2026-09-10T12:00:00.000Z",
    sevenDay: { resetAtIso: "2026-09-14T00:00:00.000Z", status: "allowed", utilization: 0.4 },
  };

  it("emits one sample per window the probe actually read", () => {
    expect(drawdownSamples({ gauges: [gauge] }).map((entry) => entry.window)).toEqual(["five-hour", "seven-day"]);
  });

  it("emits NO Fable sample when the probe did not read that window", () => {
    const windows = drawdownSamples({ gauges: [gauge] }).map((entry) => entry.window);
    expect(windows).not.toContain("fable-seven-day");
  });

  it("emits a Fable sample when the probe did read it", () => {
    const withFable: ClaudeAccountGauge = {
      ...gauge,
      sevenDayFable: { resetAtIso: "2026-09-14T00:00:00.000Z", status: "allowed", utilization: 0.1 },
    };
    expect(drawdownSamples({ gauges: [withFable] }).map((entry) => entry.window)).toContain("fable-seven-day");
  });

  it("carries the reading's own reset instant onto the sample", () => {
    expect(drawdownSamples({ gauges: [gauge] })[0]!.resetAtIso).toBe("2026-09-10T18:00:00.000Z");
  });
});

describe("drawdownRates", () => {
  it("computes a rising slope as fraction per hour", () => {
    const rates = drawdownRates({
      samples: [sample({ minutes: 0, utilization: 0.1 }), sample({ minutes: 30, utilization: 0.2 })],
    });
    expect(rates.length).toBe(1);
    expect(rates[0]!.fractionPerHour).toBeCloseTo(0.2, 10);
  });

  it("NEVER bridges a reset — a pair with different reset instants is not a rate", () => {
    const rates = drawdownRates({
      samples: [
        sample({ minutes: 0, resetAtIso: "2026-09-10T18:00:00.000Z", utilization: 0.9 }),
        sample({ minutes: 30, resetAtIso: "2026-09-10T23:00:00.000Z", utilization: 0.05 }),
      ],
    });
    expect(rates).toEqual([]);
  });

  it("drops a falling interval rather than recording a negative rate", () => {
    const rates = drawdownRates({
      samples: [sample({ minutes: 0, utilization: 0.5 }), sample({ minutes: 30, utilization: 0.4 })],
    });
    expect(rates).toEqual([]);
  });

  it("drops a flat interval, which says nothing about pace", () => {
    const rates = drawdownRates({
      samples: [sample({ minutes: 0, utilization: 0.5 }), sample({ minutes: 30, utilization: 0.5 })],
    });
    expect(rates).toEqual([]);
  });

  it("keeps two plans' series apart", () => {
    const rates = drawdownRates({
      samples: [
        sample({ minutes: 0, planAlias: "plan-a", utilization: 0.1 }),
        sample({ minutes: 30, planAlias: "plan-a", utilization: 0.2 }),
        sample({ minutes: 0, planAlias: "plan-b", utilization: 0.8 }),
        sample({ minutes: 30, planAlias: "plan-b", utilization: 0.9 }),
      ],
    });
    expect(rates.map((rate) => rate.planAlias).toSorted()).toEqual(["plan-a", "plan-b"]);
  });
});

describe("drawdownBaseline", () => {
  it("is warming with too few rates, whatever the span", () => {
    const rates = drawdownRates({
      samples: [sample({ minutes: 0, utilization: 0.1 }), sample({ minutes: 30, utilization: 0.11 })],
    });
    expect(drawdownBaseline({ rates, window: "five-hour" }).maturity).toBe("warming");
  });

  it("reports no median at all when it has no rates", () => {
    const baseline = drawdownBaseline({ rates: [], window: "five-hour" });
    expect(baseline.medianFractionPerHour).toBe(undefined);
    expect(baseline.positiveRates).toBe(0);
  });
});

/** More than a week of quiet 1%/h samples, enough to mature a baseline to `ready`. */
function quietWeek(): readonly DrawdownSample[] {
  const samples: DrawdownSample[] = [];
  for (let hour = 0; hour < 300; hour += 1) {
    samples.push({
      kind: "sample",
      observedAtIso: new Date(Date.UTC(2026, 8, 1) + hour * 3_600_000).toISOString(),
      planAlias: "plan-a",
      resetAtIso: `reset-${String(Math.floor(hour / 5))}`,
      schemaVersion: 1,
      utilization: 0.01 * (hour % 5),
      window: "five-hour",
    });
  }
  return samples;
}

describe("evaluateDrawdown", () => {
  const history = quietWeek();
  const nowIso = new Date(Date.UTC(2026, 8, 1) + 300 * 3_600_000).toISOString();

  it("matures a baseline off a week of quiet samples", () => {
    const evaluation = evaluateDrawdown({ current: [], history, nowIso });
    const fiveHour = evaluation.baselines.find((baseline) => baseline.window === "five-hour")!;
    expect(fiveHour.maturity).toBe("ready");
    expect(fiveHour.medianFractionPerHour).toBeCloseTo(0.01, 10);
  });

  it("reports no anomaly while the pace stays normal", () => {
    expect(evaluateDrawdown({ current: [], history, nowIso }).incident).toBe(undefined);
  });

  it("fires when two consecutive intervals run past ten times normal", () => {
    const base = Date.UTC(2026, 8, 1) + 300 * 3_600_000;
    const burst: readonly DrawdownSample[] = [
      {
        kind: "sample",
        observedAtIso: new Date(base).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.0,
        window: "five-hour",
      },
      {
        kind: "sample",
        observedAtIso: new Date(base + 1_800_000).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.1,
        window: "five-hour",
      },
      {
        kind: "sample",
        observedAtIso: new Date(base + 3_600_000).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.25,
        window: "five-hour",
      },
    ];
    const evaluation = evaluateDrawdown({
      current: burst,
      history,
      nowIso: new Date(base + 3_600_000).toISOString(),
    });
    expect(evaluation.incident?.triggers.length).toBe(1);
    expect(evaluation.incident?.triggers[0]!.planAlias).toBe("plan-a");
  });

  it("does NOT fire on a single fast interval", () => {
    const base = Date.UTC(2026, 8, 1) + 300 * 3_600_000;
    const oneSpike: readonly DrawdownSample[] = [
      {
        kind: "sample",
        observedAtIso: new Date(base).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.0,
        window: "five-hour",
      },
      {
        kind: "sample",
        observedAtIso: new Date(base + 1_800_000).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.2,
        window: "five-hour",
      },
    ];
    expect(
      evaluateDrawdown({ current: oneSpike, history, nowIso: new Date(base + 1_800_000).toISOString() }).incident,
    ).toBe(undefined);
  });

  it("refuses to fire at all while the baseline is still warming", () => {
    const base = Date.UTC(2026, 8, 1);
    const burst: readonly DrawdownSample[] = [
      {
        kind: "sample",
        observedAtIso: new Date(base).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "r",
        schemaVersion: 1,
        utilization: 0.0,
        window: "five-hour",
      },
      {
        kind: "sample",
        observedAtIso: new Date(base + 1_800_000).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "r",
        schemaVersion: 1,
        utilization: 0.4,
        window: "five-hour",
      },
      {
        kind: "sample",
        observedAtIso: new Date(base + 3_600_000).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "r",
        schemaVersion: 1,
        utilization: 0.9,
        window: "five-hour",
      },
    ];
    const evaluation = evaluateDrawdown({
      current: burst,
      history: [],
      nowIso: new Date(base + 3_600_000).toISOString(),
    });
    expect(evaluation.incident).toBe(undefined);
    expect(evaluation.baselines.every((baseline) => baseline.maturity === "warming")).toBe(true);
  });
});

describe("the policy keeps the owner's number on a signal that can reach it", () => {
  it("holds the 10x the owner named", () => {
    expect(DEFAULT_DRAWDOWN_POLICY.ratioThreshold).toBe(10);
  });

  it("withholds the most recent half hour so an episode cannot train its own baseline", () => {
    expect(DEFAULT_DRAWDOWN_POLICY.baselineExclusionMs).toBe(30 * 60 * 1000);
  });

  it("needs two consecutive intervals, so one odd probe pair cannot fire it", () => {
    expect(DEFAULT_DRAWDOWN_POLICY.consecutiveCandidateRates).toBe(2);
  });
});

describe("renderDrawdownEvaluation", () => {
  it("says plainly that a young watch cannot fire yet", () => {
    const lines = renderDrawdownEvaluation({
      evaluation: evaluateDrawdown({ current: [], history: [], nowIso: "2026-09-10T12:00:00.000Z" }),
    });
    expect(lines[0]).toBe("plan drawdown: no anomaly");
    expect(lines.join("\n")).toContain("warming");
  });

  it("names the plan, the window and the multiple when it fires", () => {
    const base = Date.UTC(2026, 8, 1) + 300 * 3_600_000;
    const burst: readonly DrawdownSample[] = [
      {
        kind: "sample",
        observedAtIso: new Date(base).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.0,
        window: "five-hour",
      },
      {
        kind: "sample",
        observedAtIso: new Date(base + 1_800_000).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.1,
        window: "five-hour",
      },
      {
        kind: "sample",
        observedAtIso: new Date(base + 3_600_000).toISOString(),
        planAlias: "plan-a",
        resetAtIso: "reset-live",
        schemaVersion: 1,
        utilization: 0.25,
        window: "five-hour",
      },
    ];
    const text = renderDrawdownEvaluation({
      evaluation: evaluateDrawdown({
        current: burst,
        history: quietWeek(),
        nowIso: new Date(base + 3_600_000).toISOString(),
      }),
    }).join("\n");
    expect(text).toContain("ANOMALY");
    expect(text).toContain("plan-a five-hour");
    expect(text).toContain("x its normal");
  });
});
