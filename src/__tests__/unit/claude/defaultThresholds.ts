/*
 * Test-only: the Claude routing functions with the register's DEFAULT thresholds filled in, so a case that is not
 * about a threshold reads as it did before the limits moved into the plan register. A case about a threshold calls
 * the real function with its own `thresholds`.
 */
import type { ClaudePlanSpend } from "../../../claude/contracts.js";
import { headroomToReset as realHeadroomToReset } from "../../../claude/headroom.js";
import {
  acceptanceShortfall as realAcceptanceShortfall,
  chairLevelWith as realChairLevelWith,
  planExcludedBy as realPlanExcludedBy,
  rankClaudePlans as realRankClaudePlans,
} from "../../../claude/loadBalance.js";
import {
  routeSpawnToPlan as realRouteSpawnToPlan,
  spawnBlockedBy as realSpawnBlockedBy,
} from "../../../claude/routeSpawn.js";
import {
  claudeEffectiveUsageCeiling as realClaudeEffectiveUsageCeiling,
  claudeWindowExclusion as realClaudeWindowExclusion,
  selectClaudeAccount as realSelectClaudeAccount,
  spendCapFor as realSpendCapFor,
  spendCapForSample as realSpendCapForSample,
} from "../../../claude/select.js";
import { triggerDecision as realTriggerDecision } from "../../../claude/trigger.js";
import { planWatchTick as realPlanWatchTick } from "../../../claude/watchTick.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

/* Re-exported beside its wrapped sibling, so a watch-tick case imports both from one place. */
export { classifyActiveSlot } from "../../../claude/watchTickActiveSlot.js";

/** The register's default Claude thresholds. */
export const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

type Bare<F extends (options: never) => unknown> = Omit<Parameters<F>[0], "thresholds">;

/**
 * A routing input with no monthly-spend plan unless the case names one: a case that is not about the monthly lane reads
 * as it did before that lane existed.
 */
type Routed<F extends (options: never) => unknown> = Omit<Bare<F>, "spends"> & { spends?: readonly ClaudePlanSpend[] };

/**
 * {@link realAcceptanceShortfall} at the default thresholds.
 *
 * @returns the acceptance verdict
 */
export function acceptanceShortfall(
  options: Bare<typeof realAcceptanceShortfall>,
): ReturnType<typeof realAcceptanceShortfall> {
  return realAcceptanceShortfall({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realChairLevelWith} at the default thresholds.
 *
 * @returns the plans level with the chair route
 */
export function chairLevelWith(options: Bare<typeof realChairLevelWith>): ReturnType<typeof realChairLevelWith> {
  return realChairLevelWith({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realHeadroomToReset} at the default thresholds.
 *
 * @returns the headroom
 */
export function headroomToReset(options: Bare<typeof realHeadroomToReset>): ReturnType<typeof realHeadroomToReset> {
  return realHeadroomToReset({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realPlanExcludedBy} at the default thresholds.
 *
 * @returns the exclusion
 */
export function planExcludedBy(options: Bare<typeof realPlanExcludedBy>): ReturnType<typeof realPlanExcludedBy> {
  return realPlanExcludedBy({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realRankClaudePlans} at the default thresholds.
 *
 * @returns the ranking
 */
export function rankClaudePlans(options: Bare<typeof realRankClaudePlans>): ReturnType<typeof realRankClaudePlans> {
  return realRankClaudePlans({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realRouteSpawnToPlan} at the default thresholds.
 *
 * @returns the route
 */
export function routeSpawnToPlan(
  options: Routed<typeof realRouteSpawnToPlan>,
): ReturnType<typeof realRouteSpawnToPlan> {
  const { spends = [], ...rest } = options;
  return realRouteSpawnToPlan({ ...rest, spends, thresholds: THRESHOLDS });
}

/**
 * {@link realSpawnBlockedBy} at the default thresholds.
 *
 * @returns the block
 */
export function spawnBlockedBy(options: Bare<typeof realSpawnBlockedBy>): ReturnType<typeof realSpawnBlockedBy> {
  return realSpawnBlockedBy({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realClaudeEffectiveUsageCeiling} at the default thresholds.
 *
 * @returns the ceiling
 */
export function claudeEffectiveUsageCeiling(
  options: Bare<typeof realClaudeEffectiveUsageCeiling>,
): ReturnType<typeof realClaudeEffectiveUsageCeiling> {
  return realClaudeEffectiveUsageCeiling({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realClaudeWindowExclusion} at the default thresholds.
 *
 * @returns the exclusion
 */
export function claudeWindowExclusion(
  options: Bare<typeof realClaudeWindowExclusion>,
): ReturnType<typeof realClaudeWindowExclusion> {
  return realClaudeWindowExclusion({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realSelectClaudeAccount} at the default thresholds.
 *
 * @returns the rotation decision
 */
export function selectClaudeAccount(
  options: Routed<typeof realSelectClaudeAccount>,
): ReturnType<typeof realSelectClaudeAccount> {
  const { spends = [], ...rest } = options;
  return realSelectClaudeAccount({ ...rest, spends, thresholds: THRESHOLDS });
}

/**
 * {@link realSpendCapFor} at the default thresholds.
 *
 * @returns the cap
 */
export function spendCapFor(options: Bare<typeof realSpendCapFor>): ReturnType<typeof realSpendCapFor> {
  return realSpendCapFor({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realSpendCapForSample} at the default thresholds.
 *
 * @returns the cap
 */
export function spendCapForSample(
  options: Bare<typeof realSpendCapForSample>,
): ReturnType<typeof realSpendCapForSample> {
  return realSpendCapForSample({ ...options, thresholds: THRESHOLDS });
}

/**
 * {@link realPlanWatchTick} at the default thresholds.
 *
 * @returns what the tick would do
 */
export function planWatchTick(options: Routed<typeof realPlanWatchTick>): ReturnType<typeof realPlanWatchTick> {
  const { spends = [], ...rest } = options;
  return realPlanWatchTick({ ...rest, spends, thresholds: THRESHOLDS });
}

/**
 * {@link realTriggerDecision} at the default thresholds.
 *
 * @returns the decision
 */
export function triggerDecision(options: Routed<typeof realTriggerDecision>): ReturnType<typeof realTriggerDecision> {
  const { spends = [], ...rest } = options;
  return realTriggerDecision({ ...rest, spends, thresholds: THRESHOLDS });
}
