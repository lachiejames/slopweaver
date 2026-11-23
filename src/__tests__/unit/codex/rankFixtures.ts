/**
 * Hand-built observations for the Codex ranking tests, shared by `rank.test.ts` and `rankUsageLimit.test.ts`.
 */
import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import type { CodexPlanObservation } from "../../../codex/fleetTypes.js";
import type { CodexGauge, CodexWindowReading } from "../../../codex/gauge.js";
import { rankCodexPlans as rankCodexPlansWith } from "../../../codex/rank.js";
import { type CodexThresholds, DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { PlanAllowanceKind, UsageLimitPercent } from "../../../plans/usageLimit.js";

/**
 * The real ranker, judged under the register's default Codex thresholds unless a test names others.
 *
 * @returns the ranking
 */
export function rankCodexPlans({
  thresholds = DEFAULT_THRESHOLDS.codex,
  ...rest
}: {
  nowIso: string;
  observations: readonly CodexPlanObservation[];
  thresholds?: CodexThresholds;
}): ReturnType<typeof rankCodexPlansWith> {
  return rankCodexPlansWith({ ...rest, thresholds });
}

export const NOW = "2026-09-22T12:00:00.000Z";
export const OBSERVED = "2026-09-22T11:00:00.000Z";

/**
 * One window reading, defaulting to the weekly shape a real `token_count` line carries.
 *
 * @returns the window reading
 */
export function window({
  label = "weekly",
  resetAtIso = "2026-09-29T12:00:00.000Z",
  slot = "primary",
  usedPercent,
  windowMinutes = 10080,
}: {
  label?: CodexWindowReading["label"];
  resetAtIso?: string | undefined;
  slot?: CodexWindowReading["slot"];
  usedPercent: number;
  windowMinutes?: number | undefined;
}): CodexWindowReading {
  return { label, resetAtIso, slot, usedPercent, windowMinutes };
}

/**
 * A gauge carrying the given windows and nothing that would classify it as exhausted.
 *
 * @returns the gauge
 */
export function gauge({
  observedAtIso = OBSERVED,
  windows,
}: {
  observedAtIso?: string;
  windows: readonly CodexWindowReading[];
}): CodexGauge {
  return {
    credits: undefined,
    limitId: "codex",
    observedAtIso,
    planType: "pro",
    reached: undefined,
    reachedType: undefined,
    windows,
  };
}

/**
 * One destination's whole evidence set: an eligible, unpinned, unpaused row unless told otherwise.
 *
 * @returns the observation
 */
export function observation({
  alias,
  allowance = "weekly-window",
  gauge: reading,
  live = "unreadable",
  paused,
  pinned,
  readFrom = "live",
  refuse,
  usageLimitPercent = 100,
}: {
  alias: string;
  allowance?: PlanAllowanceKind;
  gauge?: CodexGauge | undefined;
  live?: "unreadable" | "signed-out" | "store-missing";
  readFrom?: "live" | "rollout";
  paused?: { reason: string; sinceIso: string };
  pinned?: boolean;
  refuse?: string;
  usageLimitPercent?: UsageLimitPercent;
}): CodexPlanObservation {
  const codexHome = `/homes/${alias}`;
  const liveRow: CodexAccountLive =
    live === "unreadable"
      ? { codexHome, kind: "unreadable", readAtIso: NOW, reason: "no live read in this test" }
      : { codexHome, kind: live, readAtIso: NOW };
  const quota =
    refuse === undefined
      ? ({ refuse: false } as const)
      : ({ evidence: { kind: "usage-limit", observedAtIso: OBSERVED }, reason: refuse, refuse: true } as const);
  return {
    destination: { alias, codexHome },
    gauge: reading,
    gaugeSource: reading === undefined ? "none" : readFrom,
    live: liveRow,
    plan: {
      alias,
      allowance: { kind: allowance },
      provider: "codex",
      storeDir: `/homes/${alias}`,
      usageLimitPercent,
      ...(paused === undefined ? {} : { paused }),
      ...(pinned === undefined ? {} : { pinned }),
    },
    quota,
    scan: { filesRead: 1, filesSkipped: 0, filesUnreadable: 0, gauge: reading },
  };
}

/**
 * An observation whose weekly window reads the given percentage.
 *
 * @returns the observation
 */
export function weeklyAt({
  alias,
  percent,
  ...rest
}: {
  alias: string;
  percent: number;
  pinned?: boolean;
  usageLimitPercent?: UsageLimitPercent;
}): CodexPlanObservation {
  return observation({ alias, gauge: gauge({ windows: [window({ usedPercent: percent })] }), ...rest });
}
