/**
 * The demand censor judges each plan at its EFFECTIVE ceiling: the house bar lowered to its usage limit, never
 * lifted for a limited plan near its reset. A counterexample on the forecast-on-limit
 * property is the first case.
 */
import { describe, expect, it } from "vitest";

import type { DrawdownSample } from "../../../claude/drawdownAnomaly.js";
import { measureDemand } from "../../../claude/survivalDemand.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { UsageLimitPercent } from "../../../plans/usageLimit.js";

const NOW = "2026-10-01T00:00:00.000Z";
const WEEK_MS = 168 * 3_600_000;

/** One plan's censored hours off a single seven-day sample, at the given usage limit. */
function censoredAt({
  usageLimitPercent,
  observedAtIso,
  resetAtIso,
  utilization,
}: {
  usageLimitPercent: UsageLimitPercent;
  observedAtIso: string;
  resetAtIso: string;
  utilization: number;
}): number {
  const sample: DrawdownSample = {
    kind: "sample",
    observedAtIso,
    planAlias: "plan-one",
    resetAtIso,
    schemaVersion: 1,
    utilization,
    window: "seven-day",
  };
  return measureDemand({
    nowIso: NOW,
    plans: [{ alias: "plan-one", usageLimitPercent }],
    samples: [sample],
    thresholds: DEFAULT_THRESHOLDS.claude,
    windowMs: WEEK_MS,
  }).censoredHours;
}

describe("measureDemand's censor on a limited plan", () => {
  it("counts an hour censored when a 50% plan reads 50%, where an unlimited plan at 50% has room", () => {
    const reading = {
      observedAtIso: "2026-09-30T23:30:00.000Z",
      resetAtIso: "2026-10-02T00:00:00.000Z",
      utilization: 0.5,
    };
    expect(censoredAt({ ...reading, usageLimitPercent: 50 })).toBe(1);
    expect(censoredAt({ ...reading, usageLimitPercent: 100 })).toBe(0);
  });

  it("keeps a 50% plan capped at 50% in its week's last five hours, never lifted to the spend-out bar", () => {
    const reading = {
      observedAtIso: "2026-09-30T23:30:00.000Z",
      resetAtIso: "2026-10-01T01:00:00.000Z",
      utilization: 0.5,
    };
    expect(censoredAt({ ...reading, usageLimitPercent: 50 })).toBe(1);
    expect(censoredAt({ ...reading, usageLimitPercent: 50, utilization: 0.4999 })).toBe(0);
  });
});
