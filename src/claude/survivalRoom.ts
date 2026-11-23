/**
 * How much more of its week one simulated plan may take, and how a take lands on it: the room arithmetic
 * `./survivalSimulate.ts` routes demand through. Pure: every instant is passed in.
 *
 * Every ceiling here is `claudeEffectiveUsageCeiling` — the house bar, lowered to the owner's usage limit — the one
 * policy every routing gate asks, so the forecast cannot stop a plan anywhere routing would not.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { claudeEffectiveUsageCeiling } from "./select.js";
import type { SurvivalPlanState } from "./survivalPlanState.js";

/** A plan mid-simulation. */
export interface LivePlan {
  readonly alias: string;
  readonly usageLimitPercent: SurvivalPlanState["usageLimitPercent"];
  utilization: number;
  resetMs: number;
  takenThisHour: number;
  readonly absorbPerHour: number | undefined;
  cappedThisCycle: boolean;
  /** The hour this plan's week last rolled over, so a spell's end can say which way it ended. */
  rolledAtMs: number | undefined;
}

/** One plan at one instant under the install's thresholds: what every judgement below reads. */
interface PlanAt {
  readonly plan: LivePlan;
  readonly atMs: number;
  readonly thresholds: ClaudeThresholds;
}

/**
 * The float drift this simulator's own sums can carry: a week of slices adds about 2,000 terms, each off by ~1e-16.
 * Far below any utilization a gauge reports, and used ONLY to land a sum on a ceiling — never to call a plan full.
 */
export const EPSILON = 1e-12;

/**
 * An epoch instant as ISO-8601.
 *
 * @returns the instant, ISO-8601 in UTC
 */
export function isoAt({ ms }: { ms: number }): string {
  return new Date(ms).toISOString();
}

/**
 * The seven-day effective ceiling for one plan at one instant, with its source: whether the house bar or the usage
 * limit binds.
 *
 * @returns the ceiling `claudeEffectiveUsageCeiling` gives this plan at this instant
 */
export function weeklyCeilingAt({ plan, atMs, thresholds }: PlanAt): ReturnType<typeof claudeEffectiveUsageCeiling> {
  return claudeEffectiveUsageCeiling({
    claim: "seven_day",
    observedAtIso: isoAt({ ms: atMs }),
    resetAtIso: isoAt({ ms: plan.resetMs }),
    thresholds,
    usageLimitPercent: plan.usageLimitPercent,
  });
}

/**
 * How much more of its week one plan can take in this hour: its effective ceiling, and its five-hour ceiling.
 *
 * @returns the plan-weeks still open to it this hour, zero or below once it is full
 */
export function roomOf({ plan, atMs, thresholds }: PlanAt): number {
  const weekly = weeklyCeilingAt({ atMs, plan, thresholds }).utilization - plan.utilization;
  if (plan.absorbPerHour === undefined) {
    return weekly;
  }
  return Math.min(weekly, plan.absorbPerHour - plan.takenThisHour);
}

/**
 * Put `amount` on one plan. A take that fills the plan's week, or its hour, to within rounding lands it EXACTLY on
 * that ceiling, so every "is it full" test compares exactly, as routing's own `>=` does. The tolerance absorbs this
 * simulator's own sums only; a plan's READ utilization is never rounded up to its ceiling.
 *
 * @param amount the plan-weeks routed to it, never more than {@link roomOf} allows
 */
export function take({ plan, amount, atMs, thresholds }: PlanAt & { amount: number }): void {
  const weeklyCap = weeklyCeilingAt({ atMs, plan, thresholds }).utilization;
  plan.utilization = amount >= weeklyCap - plan.utilization - EPSILON ? weeklyCap : plan.utilization + amount;
  const hourly = plan.absorbPerHour;
  const fillsHour = hourly !== undefined && amount >= hourly - plan.takenThisHour - EPSILON;
  plan.takenThisHour = fillsHour ? hourly : plan.takenThisHour + amount;
}
