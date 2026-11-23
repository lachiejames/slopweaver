/**
 * Where a budget WARNING fires on one window of one plan — the fleet card and the chair's own line. Pure: a reading,
 * a plan's usage limit and the install's thresholds in, a fraction out.
 *
 * ## A warning is a share of what the owner made available
 *
 * The owner's usage limit (`../plans/usageLimit.ts`) is a ceiling on a plan's WEEK, and every routing gate stops at
 * it ({@link claudeEffectiveUsageCeiling}). A card at an absolute 75% would therefore never fire on a 50% plan: the
 * fleet stops taking it at 50% and the card that was meant to come first never comes at all. So when the limit binds
 * a weekly window, a warning sits the same SHARE of the way to that limit as it sits of the way to a whole plan: the
 * card at `alertAt × limit` (37.5% on a 50% plan by default), the chair at `routeAt × limit` (47.5%). Multiplying,
 * rather than subtracting a fixed five points, keeps the meaning as the owner lowers the limit — five points is half
 * of a 10% allowance.
 *
 * ## Where nothing changes
 *
 * A window the limit does not bind — the five-hour window, whose reset replenishes rather than strands, and every
 * window of a plan with no limit set — keeps the absolute bar it always had: `alertAt` for the card, the UN-lifted
 * `routeAt` for the chair. The un-lifted bar is the point: in a weekly window's last five hours routing spends a plan
 * to the wall itself, and a warning keyed on that lifted wall would first speak after the chair
 * is capped. The `source` the ceiling reports is carried through, so a renderer can say whether the owner's limit set
 * the point.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { UsageLimitPercent } from "../plans/usageLimit.js";
import type { ClaudeWindowReading } from "./contracts.js";
import { type ClaudeCapWindow, claudeEffectiveUsageCeiling } from "./select.js";

/** The fraction a warning fires at, and which rule set it. */
export interface ClaudeAlertPoint {
  /** `usage-limit` when the owner's limit binds this window, so the point is a share of that limit. */
  readonly source: "routing-bar" | "usage-limit";
  /** The raw fraction a reading is compared against with `>=`; round only for display. */
  readonly utilization: number;
}

/**
 * The point at the given SHARE of whatever ceiling binds a window: that share of the owner's limit when it binds, the
 * absolute bar when it does not.
 *
 * @param bar the share — `alertAt` for the card, `routeAt` for the chair — read as absolute when no limit binds
 * @param claim which window is being judged, since only the weekly ones carry the limit
 * @param observedAtIso when the reading was taken, the ceiling's only clock
 * @param thresholds the install's Claude thresholds, which set the house bar the limit is compared to
 * @param usageLimitPercent the plan's usage limit, a share of its weekly allowance
 * @param window the reading whose reset the ceiling reads
 * @returns the point, and whether the owner's limit set it
 */
function pointAt({
  bar,
  claim,
  observedAtIso,
  thresholds,
  usageLimitPercent,
  window,
}: {
  bar: number;
  claim: ClaudeCapWindow;
  observedAtIso: string;
  thresholds: ClaudeThresholds;
  usageLimitPercent: UsageLimitPercent;
  window: ClaudeWindowReading;
}): ClaudeAlertPoint {
  const ceiling = claudeEffectiveUsageCeiling({
    claim,
    observedAtIso,
    resetAtIso: window.resetAtIso,
    thresholds,
    usageLimitPercent,
  });
  if (ceiling.source === "usage-limit") {
    return { source: "usage-limit", utilization: bar * ceiling.utilization };
  }
  return { source: "routing-bar", utilization: bar };
}

/**
 * Where the fleet budget card fires on one window: `alertAt` of the way to a binding weekly usage limit, else the
 * absolute `alertAt`.
 *
 * @param claim which window is being judged
 * @param observedAtIso when the reading was taken
 * @param thresholds the install's Claude thresholds, whose alert bar is the share
 * @param usageLimitPercent the plan's usage limit
 * @param window the reading
 * @returns the card's point on this window, and whether the owner's limit set it
 */
export function claudeCardAlertPoint({
  claim,
  observedAtIso,
  thresholds,
  usageLimitPercent,
  window,
}: {
  claim: ClaudeCapWindow;
  observedAtIso: string;
  thresholds: ClaudeThresholds;
  usageLimitPercent: UsageLimitPercent;
  window: ClaudeWindowReading;
}): ClaudeAlertPoint {
  return pointAt({ bar: thresholds.alertAt, claim, observedAtIso, thresholds, usageLimitPercent, window });
}

/**
 * Where the chair's own warning fires on one window: `routeAt` of the way to a binding weekly usage limit, else the
 * UN-lifted `routeAt`, never the spend-out wall routing lifts to near a reset.
 *
 * @param claim which window is being judged
 * @param observedAtIso when the reading was taken
 * @param thresholds the install's Claude thresholds, whose un-lifted routing bar is the share
 * @param usageLimitPercent the plan's usage limit
 * @param window the reading
 * @returns the chair's point on this window, and whether the owner's limit set it
 */
export function claudeChairAlertPoint({
  claim,
  observedAtIso,
  thresholds,
  usageLimitPercent,
  window,
}: {
  claim: ClaudeCapWindow;
  observedAtIso: string;
  thresholds: ClaudeThresholds;
  usageLimitPercent: UsageLimitPercent;
  window: ClaudeWindowReading;
}): ClaudeAlertPoint {
  return pointAt({ bar: thresholds.routeAt, claim, observedAtIso, thresholds, usageLimitPercent, window });
}
