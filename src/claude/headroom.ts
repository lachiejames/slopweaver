/**
 * How far a plan's weekly windows sit below their own level lines: the measure every ranking in `loadBalance.ts`
 * keys on first, and the one the chair's level band compares. Pure: no clock, no filesystem, no network.
 */

import { parseIsoMs } from "#lib/date.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { UsageLimitPercent } from "../plans/usageLimit.js";
import type { ClaudePlanGauge, ClaudeWindowReading } from "./contracts.js";
import { fableSeatThresholds } from "./fableSeatBars.js";
import { type ClaudeCapWindow, claudeEffectiveUsageCeiling, insideSpendOut } from "./select.js";

/** How long a weekly window runs, from the reset that opened it to the reset that closes it. */
const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * How far one weekly window sits BELOW its own level line — the plan-week fraction it has left over against
 * what an evenly drawn week would have spent by now. Positive is behind, so it is spent first; negative is
 * ahead, and loses to every plan that is behind.
 *
 * The level line runs from 0 at the reset that opened the week to the cap at the moment the cap stops applying.
 * Away from a reset the cap is 95% and it holds until the last five hours open, so the line reaches 95% at the
 * reset less five hours; inside them the cap is 100% and the line reaches it at the reset itself
 * (`select.ts`'s `spendCapFor`). Crossing into those hours lifts the line by the five points the lift
 * releases, which is what makes them worth spending before they strand.
 *
 * It is POINTS, never points per hour. Dividing the headroom by the hours left is what made a plan at 78% with
 * 22 hours to its reset outrank one at 0% with six days left — MEASURED, `claude gauge` printing
 * `next fable spawn -> plan-four` at 86% week while plan-three sat at 1% — and piled every spawn onto the plan
 * nearest its wall until it walled. Counted in points, that plan was 7 behind its line and the empty one 15.
 *
 * A reading observed at or past its own reset clamps its line to the cap, so a week that has rolled over ranks on
 * all the headroom its stale reading still shows, never less; a reading whose instants do not parse ranks behind
 * every one that does.
 *
 * ## The line's HEIGHT is the plan's effective ceiling, not 95%
 *
 * A plan the owner limited to 30% has a week whose line ends at 30% ({@link claudeEffectiveUsageCeiling}): ranked
 * against a 95% line it would read permanently far behind and take every spawn until its own gate caught it. The
 * line's DEADLINE stays the house bar's — the reset less five hours, or the reset itself once the house lift is in
 * force — because the limit lowers how much of a week may be spent, not when the week ends.
 *
 * @param claim which weekly window, so {@link claudeEffectiveUsageCeiling} names its cap
 * @param observedAtIso the gauge's own timestamp, the only clock a reading is good for
 * @param thresholds the install's Claude thresholds, which set the line's deadline and the house height
 * @param usageLimitPercent the plan's usage limit, which lowers the line's height on a weekly window
 * @returns the plan-week fraction this window is behind its level line, negative when ahead
 */
export function headroomToReset({
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
}): number {
  const resetMs = parseIsoMs({ tsIso: window.resetAtIso });
  const observedMs = parseIsoMs({ tsIso: observedAtIso });
  if (resetMs === undefined || observedMs === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  const ceiling = claudeEffectiveUsageCeiling({
    claim,
    observedAtIso,
    resetAtIso: window.resetAtIso,
    thresholds,
    usageLimitPercent,
  });
  const spendingOut = insideSpendOut({ claim, observedAtIso, resetAtIso: window.resetAtIso, thresholds });
  const deadlineMs = spendingOut ? resetMs : resetMs - thresholds.spendOutBeforeResetMs;
  const openedMs = resetMs - WEEK_MS;
  const elapsed = Math.min(Math.max((observedMs - openedMs) / (deadlineMs - openedMs), 0), 1);
  return ceiling.utilization * elapsed - window.utilization;
}

/**
 * The plan-wide week's {@link headroomToReset}, to the plan's own effective ceiling.
 *
 * @param gauge the plan's reading
 * @param thresholds the Claude thresholds the week is lined up under
 * @returns the fraction of a week the plan-wide window sits behind its level line, negative when ahead
 */
export function weekHeadroom({ gauge, thresholds }: { gauge: ClaudePlanGauge; thresholds: ClaudeThresholds }): number {
  return headroomToReset({
    claim: "seven_day",
    observedAtIso: gauge.observedAtIso,
    thresholds,
    usageLimitPercent: gauge.usageLimitPercent,
    window: gauge.sevenDay,
  });
}

/**
 * A Fable seat's BINDING headroom on one measured plan: the lesser of its Fable week's and its plan-wide week's
 * {@link headroomToReset}, the plan-wide week lined up under {@link fableSeatThresholds} and, for the chair, the Fable
 * week too. `loadBalance.ts`'s Fable ranking key leads on it, and its `chairLevelWith` measures a near-tie in it.
 *
 * @param chair whether this spawn seats the supervisor chair
 * @param gauge the plan's reading, which must carry a Fable window
 * @param thresholds the install's Claude thresholds
 * @returns the fraction of a week the binding window sits behind its level line, negative when ahead
 */
export function bindingFableHeadroom({
  chair,
  gauge,
  thresholds,
}: {
  chair: boolean;
  gauge: ClaudePlanGauge;
  thresholds: ClaudeThresholds;
}): number {
  const seat = fableSeatThresholds({ thresholds });
  const fableHeadroom = headroomToReset({
    claim: "seven_day_fable",
    observedAtIso: gauge.observedAtIso,
    thresholds: chair ? seat : thresholds,
    usageLimitPercent: gauge.usageLimitPercent,
    window: gauge.sevenDayFable!,
  });
  return Math.min(fableHeadroom, weekHeadroom({ gauge, thresholds: seat }));
}
