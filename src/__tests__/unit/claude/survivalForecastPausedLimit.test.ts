/**
 * A paused plan keeps the usage limit its register row sets whether the journal placed it or never read it, so the
 * forecast still names the limit of an unread one.
 */
import { describe, expect, it } from "vitest";
import type { DrawdownSample } from "../../../claude/drawdownAnomaly.js";
import { forecastSurvival, type SurvivalForecast, type SurvivalRead } from "../../../claude/survivalForecast.js";
import type { SurvivalPlanInput } from "../../../claude/survivalPlanState.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { UsageLimitPercent } from "../../../plans/usageLimit.js";

const NOW = "2026-10-01T00:00:00.000Z";
const HOUR_MS = 3_600_000;

/** An instant `hours` from {@link NOW}, negative for the past. */
function at({ hours }: { hours: number }): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

/** One seven-day journal sample. */
function sample({ alias, hours, utilization }: { alias: string; hours: number; utilization: number }): DrawdownSample {
  return {
    kind: "sample",
    observedAtIso: at({ hours }),
    planAlias: alias,
    resetAtIso: at({ hours: alias === "a" ? 30 : 50 }),
    schemaVersion: 1,
    utilization,
    window: "seven-day",
  };
}

/** A configured plan, paused when `paused` is set, held to `usageLimitPercent`. */
function input({
  alias,
  paused,
  usageLimitPercent,
}: {
  alias: string;
  paused: boolean;
  usageLimitPercent: UsageLimitPercent;
}): SurvivalPlanInput {
  const pause = paused ? { reason: "a bounced charge", sinceIso: at({ hours: -240 }) } : undefined;
  return { alias, paused: pause, usageLimitPercent };
}

/** The forecast inside a read, throwing when there is none so the assertion itself carries no branch. */
function forecastOf({ read }: { read: SurvivalRead }): SurvivalForecast {
  if (read.kind !== "forecast") {
    throw new Error(`expected a forecast, got: ${read.because}`);
  }
  return read.forecast;
}

describe("forecastSurvival, a paused plan's usage limit", () => {
  it("carries a paused plan's 50% limit when it is placed and when the journal never read it", () => {
    const read = forecastSurvival({
      demandBasis: "trailing",
      nowIso: NOW,
      plans: [
        input({ alias: "a", paused: false, usageLimitPercent: 100 }),
        input({ alias: "c", paused: true, usageLimitPercent: 50 }),
        input({ alias: "d", paused: true, usageLimitPercent: 50 }),
      ],
      samples: [
        ...[-3, -2, -1].map((hours) => sample({ alias: "a", hours, utilization: 0.5 + (hours + 3) * 0.1 })),
        sample({ alias: "c", hours: -10, utilization: 0.4 }),
      ],
      thresholds: DEFAULT_THRESHOLDS.claude,
      weeks: 1,
    });
    const { paused } = forecastOf({ read });
    expect(
      paused.map((row) => [row.alias, row.placement, row.usageLimitPercent, row.state?.usageLimitPercent]),
    ).toEqual([
      ["c", "observed", 50, 50],
      ["d", "unread", 50, undefined],
    ]);
  });
});
