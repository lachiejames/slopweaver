import { describe, expect, it } from "vitest";

import {
  ALERT_TREND_PRIOR_WINDOWS_MAX,
  deriveTrend,
  ratioText,
  TREND_VERDICTS,
  trendClause,
  trendSentence,
} from "../../../../outbound/artifact/trend.js";

describe("deriveTrend — a baseline is judged, or it is declined", () => {
  it("divides this window by the baseline's PER-WINDOW average, never by its total", () => {
    const trend = deriveTrend({ current: 41, reading: { priorTotal: 57, priorWindows: 3 } })!;

    expect(trend.perWindow).toBe(19);
    expect(trend.ratio).toBeCloseTo(41 / 19, 10);
  });

  it("calls three times the baseline on fire", () => {
    expect(deriveTrend({ current: 60, reading: { priorTotal: 60, priorWindows: 3 } })!.verdict).toBe("on-fire");
  });

  it("calls one and a half times up", () => {
    expect(deriveTrend({ current: 30, reading: { priorTotal: 60, priorWindows: 3 } })!.verdict).toBe("up");
  });

  it("calls a third quieter down", () => {
    expect(deriveTrend({ current: 13, reading: { priorTotal: 60, priorWindows: 3 } })!.verdict).toBe("down");
  });

  it("calls everything between them steady", () => {
    expect(deriveTrend({ current: 21, reading: { priorTotal: 60, priorWindows: 3 } })!.verdict).toBe("steady");
  });

  it("declines when NO baseline was read, because an absent field is not a quiet window", () => {
    expect(deriveTrend({ current: 41, reading: undefined })).toBeUndefined();
  });

  it("declines on a baseline that counted nothing, which is an absence of evidence", () => {
    expect(deriveTrend({ current: 41, reading: { priorTotal: 0, priorWindows: 3 } })).toBeUndefined();
  });

  it("declines on a baseline covering no whole window", () => {
    expect(deriveTrend({ current: 41, reading: { priorTotal: 57, priorWindows: 0 } })).toBeUndefined();
  });

  it("carries the reading it judged, so no renderer has to fetch it a second time", () => {
    expect(deriveTrend({ current: 1, reading: { priorTotal: 9, priorWindows: 3 } })!.reading).toEqual({
      priorTotal: 9,
      priorWindows: 3,
    });
  });

  it("names a verdict that is one of the declared set", () => {
    expect(TREND_VERDICTS.length).toBeGreaterThan(0);
    const verdict = deriveTrend({ current: 41, reading: { priorTotal: 57, priorWindows: 3 } })!.verdict;

    expect(TREND_VERDICTS).toContain(verdict);
  });
});

describe("ratioText — bounded, because it lands in a TL;DR whose width is promised", () => {
  it("prints one decimal", () => {
    expect(ratioText({ ratio: 2.16 })).toBe("2.2×");
  });

  it("CLAMPS a huge ratio for display, marking the clamp, without the verdict having clamped", () => {
    expect(ratioText({ ratio: 4000 })).toBe(">99.9×");
  });

  it("marks a ratio that would ROUND past the clamp too, since 99.95 is not 99.9", () => {
    expect(ratioText({ ratio: 99.95 })).toBe(">99.9×");
    expect(ratioText({ ratio: 99.9 })).toBe("99.9×");
  });
});

describe("trendClause — the TL;DR half", () => {
  it("names how many windows the baseline covers", () => {
    const trend = deriveTrend({ current: 41, reading: { priorTotal: 57, priorWindows: 3 } });

    expect(trendClause({ trend })).toBe(" 2.2× the prior 3 windows.");
  });

  it("agrees the noun with a single prior window", () => {
    const trend = deriveTrend({ current: 4, reading: { priorTotal: 2, priorWindows: 1 } });

    expect(trendClause({ trend })).toBe(" 2.0× the prior window.");
  });

  it("is nothing at all when there is no trend, so the TL;DR omits the clause rather than hedging it", () => {
    expect(trendClause({ trend: undefined })).toBeUndefined();
  });

  it("stays inside the width its own cap promises, at the widest ratio and the most windows", () => {
    const trend = deriveTrend({ current: 1_000_000, reading: { priorTotal: 1, priorWindows: 1 } })!;
    const clause = trendClause({
      trend: { ...trend, reading: { priorTotal: 1, priorWindows: ALERT_TREND_PRIOR_WINDOWS_MAX } },
    })!;

    // 28 is the number `ALERT_SUMMARY_LEAD_VISIBLE_MAX`'s own arithmetic budgets for this clause.
    expect(clause.length).toBe(28);
  });
});

describe("trendSentence — both raw numbers, because a ratio hides what is most likely wrong about it", () => {
  it("prints the baseline, its per-window average and this window", () => {
    const trend = deriveTrend({ current: 41, reading: { priorTotal: 57, priorWindows: 3 } });

    expect(trendSentence({ counted: "alerts", current: 41, trend, window: "24h" })).toBe(
      "Prior 3 × 24h: 57 alerts, 19.0 per window. This window: 41.",
    );
  });

  it("states the ABSENCE when no baseline was read, rather than saying nothing at all", () => {
    expect(trendSentence({ counted: "alerts", current: 41, trend: undefined, window: "24h" })).toBe(
      "No comparison with the prior windows was made.",
    );
  });
});
