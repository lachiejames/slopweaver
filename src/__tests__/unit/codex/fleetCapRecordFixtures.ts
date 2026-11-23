/**
 * Hand-built observations and rankings for the Codex fleet-cap record tests, shared by `fleetCapRecord.test.ts`.
 */
import type { CodexPlanObservation, CodexPlanRanking } from "../../../codex/fleetTypes.js";
import type { CodexGauge } from "../../../codex/gauge.js";
import type { CodexQuotaDecision } from "../../../codex/quotaGate.js";
import type { PlanAllowanceKind, UsageLimitPercent } from "../../../plans/usageLimit.js";

export const NOW = "2026-09-29T00:00:00.000Z";
export const ONE = { alias: "codex-one", codexHome: "/state/codex-one" };
export const TWO = { alias: "codex-two", codexHome: "/state/codex-two" };
export const THREE = { alias: "codex-three", codexHome: "/state/codex-three" };

/**
 * A gauge reading both windows at the given percentages, each with its own reset.
 *
 * @returns the gauge
 */
export function gauge({
  fiveHour,
  weekly,
}: {
  fiveHour: { usedPercent: number; resetAtIso: string };
  weekly: { usedPercent: number; resetAtIso: string };
}): CodexGauge {
  return {
    credits: undefined,
    limitId: "codex",
    observedAtIso: "2026-09-28T23:00:00.000Z",
    planType: "pro",
    reached: undefined,
    reachedType: undefined,
    windows: [
      { label: "five-hour", slot: "primary", windowMinutes: 300, ...fiveHour },
      { label: "weekly", slot: "secondary", windowMinutes: 10_080, ...weekly },
    ],
  };
}

/**
 * One observation, with only the fields the record reads carrying anything.
 *
 * @returns the observation
 */
export function observation({
  allowance = "weekly-window",
  destination,
  gauge: reading,
  quota = { refuse: false },
  usageLimitPercent = 100,
}: {
  allowance?: PlanAllowanceKind;
  destination: { alias: string; codexHome: string };
  gauge?: CodexGauge;
  quota?: CodexQuotaDecision;
  usageLimitPercent?: UsageLimitPercent;
}): CodexPlanObservation {
  return {
    destination,
    gauge: reading,
    gaugeSource: reading === undefined ? "none" : "live",
    live: { codexHome: destination.codexHome, kind: "unreadable", readAtIso: NOW, reason: "no live read" },
    plan: {
      alias: destination.alias,
      allowance: { kind: allowance },
      provider: "codex",
      storeDir: destination.codexHome,
      usageLimitPercent,
    },
    quota,
    scan: { filesRead: 0, filesSkipped: 0, filesUnreadable: 0, gauge: undefined },
  };
}

/**
 * A ranking with nothing eligible and the given exclusions.
 *
 * @returns the ranking
 */
export function nothingEligible({ excluded }: { excluded: CodexPlanRanking["excluded"] }): CodexPlanRanking {
  return { basis: "no-eligible-destination", deferredUnmeasured: [], excluded, ranked: [] };
}
