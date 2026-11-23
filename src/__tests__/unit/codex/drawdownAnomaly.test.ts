import { describe, expect, it } from "vitest";

import {
  type CodexDrawdownEvaluation,
  type CodexDrawdownPolicy,
  type CodexDrawdownSample,
  DEFAULT_CODEX_DRAWDOWN_POLICY,
  evaluateCodexDrawdown,
  renderCodexDrawdown,
} from "../../../codex/drawdownAnomaly.js";
import { codexDrawdownRates, codexDrawdownSamples } from "../../../codex/drawdownSeries.js";
import type { CodexGauge } from "../../../codex/gauge.js";

const SCOPE = "self_serve_business_prolite";
const LIMIT = "codex";
const RESET = "2026-09-19T08:25:25.000Z";
const WEEKLY = 10080;

/** A policy with everything relaxed, so a case can turn one knob and assert on that knob alone. */
const OPEN_POLICY: CodexDrawdownPolicy = {
  absoluteBurnFloorPercentPerHour: 0,
  baselineLookbackMs: 365 * 24 * 60 * 60 * 1000,
  maximumIntervalMs: 24 * 60 * 60 * 1000,
  minimumBaselineIntervals: 1,
  minimumIntervalMs: 60 * 1000,
  minimumObservedSpanMs: 0,
  ratioThreshold: 2,
  stalenessMs: 365 * 24 * 60 * 60 * 1000,
};

/** One reading, as the journal holds it. */
function sample({
  observedAtIso,
  usedPercent,
  resetAtIso = RESET,
  windowMinutes = WEEKLY,
  accountScope = SCOPE,
  limitId = LIMIT,
  slot = "primary",
}: {
  observedAtIso: string;
  usedPercent: number;
  resetAtIso?: string;
  windowMinutes?: number;
  accountScope?: string;
  limitId?: string;
  slot?: string;
}): CodexDrawdownSample {
  return {
    accountScope,
    kind: "sample",
    limitId,
    observedAtIso,
    resetAtIso,
    schemaVersion: 1,
    sourceEventId: [observedAtIso, limitId, slot, String(usedPercent)].join("~"),
    usedPercent,
    windowMinutes,
  };
}

/** A `token_count` gauge carrying one or two windows. */
function gauge({
  observedAtIso,
  windows,
  limitId = LIMIT,
  planType = SCOPE,
}: {
  observedAtIso: string;
  windows: readonly CodexGauge["windows"][number][];
  limitId?: string;
  planType?: string;
}): CodexGauge {
  return {
    credits: undefined,
    limitId,
    observedAtIso,
    planType,
    reached: undefined,
    reachedType: undefined,
    windows,
  };
}

/**
 * One window slot of a gauge.
 *
 * `windowMinutes` and `resetAtIso` are NOT defaulted parameters, and that is the point rather than a style
 * choice: `f(x = DEFAULT)` substitutes the default when a caller passes `undefined`, so a case written to
 * prove that an absent width is dropped would silently be handed a present one and pass against the
 * opposite behaviour. They are spread in only when a key is present on the input.
 */
function window({
  usedPercent,
  slot = "primary",
  ...rest
}: {
  usedPercent: number;
  slot?: "primary" | "secondary";
  windowMinutes?: number | undefined;
  resetAtIso?: string | undefined;
}): CodexGauge["windows"][number] {
  return {
    label: "weekly",
    resetAtIso: "resetAtIso" in rest ? rest.resetAtIso : RESET,
    slot,
    usedPercent,
    windowMinutes: "windowMinutes" in rest ? rest.windowMinutes : WEEKLY,
  };
}

/** An evaluation's episode, unwrapped by throwing rather than by a conditional in an assertion. */
function episodeOf({
  evaluation,
}: {
  evaluation: CodexDrawdownEvaluation;
}): NonNullable<CodexDrawdownEvaluation["episode"]> {
  const episode = evaluation.episode;
  if (episode === undefined) {
    throw new Error(`expected an episode, got verdict ${evaluation.verdict}: ${evaluation.why}`);
  }
  return episode;
}

/** A flat run of readings one hour apart, climbing by `perHour` points each time. */
function steadyRun({ from, hours, perHour }: { from: number; hours: number; perHour: number }): CodexDrawdownSample[] {
  const out: CodexDrawdownSample[] = [];
  for (let index = 0; index <= hours; index++) {
    out.push(
      sample({
        observedAtIso: new Date(Date.UTC(2026, 8, 12, index, 0, 0)).toISOString(),
        usedPercent: from + index * perHour,
      }),
    );
  }
  return out;
}

describe("codexDrawdownSamples", () => {
  it("drops a window with no declared width — the width is half of what identifies a series", () => {
    const samples = codexDrawdownSamples({
      gauges: [
        gauge({
          observedAtIso: "2026-09-12T00:00:00.000Z",
          windows: [window({ usedPercent: 100, windowMinutes: undefined })],
        }),
      ],
    });

    expect(samples).toStrictEqual([]);
  });

  it("drops a window with no reset instant, so a reset cannot read as a negative delta", () => {
    const samples = codexDrawdownSamples({
      gauges: [
        gauge({
          observedAtIso: "2026-09-12T00:00:00.000Z",
          windows: [window({ resetAtIso: undefined, usedPercent: 40 })],
        }),
      ],
    });

    expect(samples).toStrictEqual([]);
  });

  it("yields nothing at all from an exhaustion event, which nulls both slots", () => {
    expect(
      codexDrawdownSamples({ gauges: [gauge({ observedAtIso: "2026-09-12T00:00:00.000Z", windows: [] })] }),
    ).toStrictEqual([]);
  });

  it("keeps a MEASURED zero, which is a reading and not an absence", () => {
    const samples = codexDrawdownSamples({
      gauges: [gauge({ observedAtIso: "2026-09-12T00:00:00.000Z", windows: [window({ usedPercent: 0 })] })],
    });

    expect(samples.length).toBe(1);
    expect(samples[0]!.usedPercent).toBe(0);
  });

  it("takes both slots of one event as two readings", () => {
    const samples = codexDrawdownSamples({
      gauges: [
        gauge({
          observedAtIso: "2026-09-12T00:00:00.000Z",
          windows: [window({ usedPercent: 40 }), window({ slot: "secondary", usedPercent: 12, windowMinutes: 300 })],
        }),
      ],
    });

    expect(samples.map((entry) => [entry.windowMinutes, entry.usedPercent])).toStrictEqual([
      [WEEKLY, 40],
      [300, 12],
    ]);
  });

  it("deduplicates a repeated event, so re-reading the same tail cannot double-count it", () => {
    const one = gauge({ observedAtIso: "2026-09-12T00:00:00.000Z", windows: [window({ usedPercent: 40 })] });

    expect(codexDrawdownSamples({ gauges: [one, one, one] }).length).toBe(1);
  });
});

describe("codexDrawdownRates", () => {
  it("refuses a pair closer together than the minimum interval, rather than dividing by a near-zero time", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 40 }),
        sample({ observedAtIso: "2026-09-12T00:00:40.000Z", usedPercent: 41 }),
      ],
    });

    expect(rates).toStrictEqual([]);
  });

  it("refuses a pair further apart than the maximum interval — a quiet night is not one episode", () => {
    const rates = codexDrawdownRates({
      policy: { ...OPEN_POLICY, maximumIntervalMs: 60 * 60 * 1000 },
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 40 }),
        sample({ observedAtIso: "2026-09-12T09:00:00.000Z", usedPercent: 60 }),
      ],
    });

    expect(rates).toStrictEqual([]);
  });

  it("refuses a NEGATIVE delta, which is a reset nobody announced rather than negative burn", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 90 }),
        sample({ observedAtIso: "2026-09-12T01:00:00.000Z", usedPercent: 3 }),
      ],
    });

    expect(rates).toStrictEqual([]);
  });

  it("never forms a slope across a CHANGED reset — that is a new window, not a drop", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 90 }),
        sample({ observedAtIso: "2026-09-12T01:00:00.000Z", resetAtIso: "2026-09-26T08:25:25.000Z", usedPercent: 95 }),
      ],
    });

    expect(rates).toStrictEqual([]);
  });

  it("computes percentage POINTS per hour, on the provider's own 0..100 scale", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 10 }),
        sample({ observedAtIso: "2026-09-12T02:00:00.000Z", usedPercent: 30 }),
      ],
    });

    expect(rates.length).toBe(1);
    expect(rates[0]!.percentPointsPerHour).toBeCloseTo(10, 10);
  });

  it("uses NON-OVERLAPPING intervals, so five dense readings do not outvote one sparse hour", () => {
    // Four readings inside one minute then one an hour later. Pairing every adjacent pair would emit four
    // sub-minute intervals; the non-overlapping walk emits exactly one, anchored on the first.
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 10 }),
        sample({ observedAtIso: "2026-09-12T00:00:10.000Z", usedPercent: 11 }),
        sample({ observedAtIso: "2026-09-12T00:00:20.000Z", usedPercent: 12 }),
        sample({ observedAtIso: "2026-09-12T00:00:30.000Z", usedPercent: 13 }),
        sample({ observedAtIso: "2026-09-12T01:00:00.000Z", usedPercent: 20 }),
      ],
    });

    expect(rates.length).toBe(1);
    expect(rates[0]!.fromIso).toBe("2026-09-12T00:00:00.000Z");
    expect(rates[0]!.toIso).toBe("2026-09-12T01:00:00.000Z");
  });

  it("emits nothing for two readings at the SAME instant, rather than manufacturing elapsed time", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", slot: "primary", usedPercent: 10 }),
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", slot: "secondary", usedPercent: 90 }),
      ],
    });

    expect(rates).toStrictEqual([]);
  });

  it("keeps a series whose window moved between SLOTS as one series, because slot is not its identity", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", slot: "primary", usedPercent: 10 }),
        sample({ observedAtIso: "2026-09-12T01:00:00.000Z", slot: "secondary", usedPercent: 20 }),
      ],
    });

    expect(rates.length).toBe(1);
    expect(rates[0]!.percentPointsPerHour).toBeCloseTo(10, 10);
  });

  it("treats reset instants a second apart as ONE series — the provider jitters its own resets", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", resetAtIso: "2026-09-19T08:25:25.000Z", usedPercent: 10 }),
        sample({ observedAtIso: "2026-09-12T01:00:00.000Z", resetAtIso: "2026-09-19T08:25:26.000Z", usedPercent: 20 }),
      ],
    });

    expect(rates.length).toBe(1);
    expect(rates[0]!.percentPointsPerHour).toBeCloseTo(10, 10);
  });

  it("still separates two windows whose resets are a real window apart", () => {
    const rates = codexDrawdownRates({
      policy: OPEN_POLICY,
      samples: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", resetAtIso: "2026-09-19T08:25:25.000Z", usedPercent: 10 }),
        sample({ observedAtIso: "2026-09-12T01:00:00.000Z", resetAtIso: "2026-09-26T08:25:25.000Z", usedPercent: 20 }),
      ],
    });

    expect(rates).toStrictEqual([]);
  });
});

describe("evaluateCodexDrawdown", () => {
  it("reports WARMING — never `normal` — before there is a span to compare against", () => {
    const evaluation = evaluateCodexDrawdown({
      current: [],
      history: [sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 10 })],
      nowIso: "2026-09-12T01:00:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(evaluation.verdict).toBe("warming");
    expect(evaluation.why).toContain("not yet a normal to compare it against");
    expect(evaluation.episode).toBeUndefined();
  });

  it("reports INSUFFICIENT-COVERAGE when the span is long enough but the readings inside it are too sparse", () => {
    // Two readings a day apart: the span clears the minimum, and exactly one interval exists, which is fewer
    // than a baseline needs. That is a different fact from `warming`, and it has a different fix.
    const evaluation = evaluateCodexDrawdown({
      current: [],
      history: [
        sample({ observedAtIso: "2026-09-12T00:00:00.000Z", usedPercent: 10 }),
        sample({ observedAtIso: "2026-09-13T00:00:00.000Z", usedPercent: 20 }),
      ],
      nowIso: "2026-09-13T01:00:00.000Z",
      policy: { ...DEFAULT_CODEX_DRAWDOWN_POLICY, maximumIntervalMs: 48 * 60 * 60 * 1000 },
    });

    expect(evaluation.verdict).toBe("insufficient-coverage");
    expect(evaluation.why).toContain("too sparse");
    expect(evaluation.episode).toBeUndefined();
  });

  it("reports NORMAL when the current pace sits inside its series' own measured one", () => {
    const history = steadyRun({ from: 0, hours: 20, perHour: 2 });
    const evaluation = evaluateCodexDrawdown({
      current: [sample({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 42 })],
      history,
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(evaluation.verdict).toBe("normal");
    expect(evaluation.episode).toBeUndefined();
  });

  it("fires an ANOMALY on a current interval past the threshold, carrying the exact trigger values", () => {
    const history = steadyRun({ from: 0, hours: 20, perHour: 2 });
    const evaluation = evaluateCodexDrawdown({
      current: [sample({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 65 })],
      history,
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    const episode = episodeOf({ evaluation });

    expect(evaluation.verdict).toBe("anomaly");
    expect(episode.triggers.length).toBe(1);
    // 40 points at hour 20, 65 at hour 21: 25 points in one hour against a measured 2.
    expect(episode.triggers[0]!.currentPercentPointsPerHour).toBeCloseTo(25, 10);
    expect(episode.triggers[0]!.baselinePercentPointsPerHour).toBeCloseTo(2, 10);
    expect(episode.triggers[0]!.ratio).toBeCloseTo(12.5, 10);
  });

  it("keeps the CURRENT interval out of the baseline it is judged against", () => {
    // The same current reading is judged against a history that does not contain it. Folding it in would
    // raise the baseline and shrink the ratio, which is how a long episode makes itself look ordinary.
    const history = steadyRun({ from: 0, hours: 20, perHour: 2 });
    const current = sample({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 65 });
    const judged = evaluateCodexDrawdown({
      current: [current],
      history,
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });
    const folded = evaluateCodexDrawdown({
      current: [],
      history: [...history, current],
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(judged.verdict).toBe("anomaly");
    expect(folded.verdict).toBe("normal");
  });

  it("refuses to fire below the absolute burn floor, however large the ratio", () => {
    // A baseline of 0.1 points/h and a current 4 points/h is a 40x ratio and still an ordinary few minutes
    // of work. The floor is what stops a quiet week manufacturing an emergency out of it.
    const history = steadyRun({ from: 0, hours: 20, perHour: 0.1 });
    const evaluation = evaluateCodexDrawdown({
      current: [sample({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 6 })],
      history,
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(evaluation.verdict).toBe("normal");
  });

  it("gives the same episode the SAME id on a second evaluation, so suppression can hold", () => {
    const history = steadyRun({ from: 0, hours: 20, perHour: 2 });
    const current = [sample({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 65 })];
    const first = evaluateCodexDrawdown({
      current,
      history,
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });
    const second = evaluateCodexDrawdown({
      current,
      history,
      nowIso: "2026-09-12T23:59:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(episodeOf({ evaluation: second }).episodeId).toBe(episodeOf({ evaluation: first }).episodeId);
  });

  it("gives a DIFFERENT episode id after a reset, because the reset is part of every series identity", () => {
    const history = steadyRun({ from: 0, hours: 20, perHour: 2 });
    const afterReset = steadyRun({ from: 0, hours: 20, perHour: 2 }).map((entry) => ({
      ...entry,
      resetAtIso: "2026-09-26T08:25:25.000Z",
      sourceEventId: `${entry.sourceEventId}-next`,
    }));
    const before = evaluateCodexDrawdown({
      current: [sample({ observedAtIso: "2026-09-12T21:00:00.000Z", usedPercent: 65 })],
      history,
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });
    const after = evaluateCodexDrawdown({
      current: [
        sample({
          observedAtIso: "2026-09-12T21:00:00.000Z",
          resetAtIso: "2026-09-26T08:25:25.000Z",
          usedPercent: 65,
        }),
      ],
      history: afterReset,
      nowIso: "2026-09-12T21:30:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(episodeOf({ evaluation: after }).episodeId).not.toBe(episodeOf({ evaluation: before }).episodeId);
  });

  it("ignores history older than the staleness bound — a stale series is not a normal", () => {
    const evaluation = evaluateCodexDrawdown({
      current: [],
      history: steadyRun({ from: 0, hours: 20, perHour: 2 }),
      nowIso: "2027-09-12T00:00:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(evaluation.baselines).toStrictEqual([]);
    expect(evaluation.verdict).toBe("insufficient-coverage");
  });

  it("weights the baseline by DURATION, so a busy minute does not count as much as a quiet hour", () => {
    // Twenty-one hourly readings at 2 points/h, plus a burst of four readings inside one minute at the very
    // start. A mean of the per-interval slopes would be dragged by the burst; a duration-weighted one is not,
    // and the non-overlapping walk discards the sub-minute pairs anyway.
    const dense = [
      sample({ observedAtIso: "2026-09-12T00:00:10.000Z", usedPercent: 0.5 }),
      sample({ observedAtIso: "2026-09-12T00:00:20.000Z", usedPercent: 1 }),
      sample({ observedAtIso: "2026-09-12T00:00:30.000Z", usedPercent: 1.5 }),
    ];
    const evaluation = evaluateCodexDrawdown({
      current: [],
      history: [...steadyRun({ from: 0, hours: 20, perHour: 2 }), ...dense],
      nowIso: "2026-09-12T21:00:00.000Z",
      policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
    });

    expect(evaluation.baselines.length).toBe(1);
    expect(evaluation.baselines[0]!.percentPointsPerHour).toBeCloseTo(2, 1);
  });
});

describe("renderCodexDrawdown", () => {
  it("always leads with the VERDICT, so a quiet report cannot read as a finding of ordinary use", () => {
    const lines = renderCodexDrawdown({
      evaluation: evaluateCodexDrawdown({
        current: [],
        history: [],
        nowIso: "2026-09-12T00:00:00.000Z",
        policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
      }),
    });

    expect(lines[0]).toContain("codex burn: WARMING —");
  });

  it("names each baseline by its SERIES, not only its window width", () => {
    const lines = renderCodexDrawdown({
      evaluation: evaluateCodexDrawdown({
        current: [],
        history: steadyRun({ from: 0, hours: 20, perHour: 2 }),
        nowIso: "2026-09-12T21:00:00.000Z",
        policy: DEFAULT_CODEX_DRAWDOWN_POLICY,
      }),
    });

    expect(lines.join("\n")).toContain(`${SCOPE}~${LIMIT}~${String(WEEKLY)}~${RESET}: 2.00 points/h`);
  });
});
