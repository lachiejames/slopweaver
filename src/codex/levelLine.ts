/**
 * The level line a Codex plan's weekly window is spent against, as one pure function — shared by the live router
 * (`./rank.ts`'s `weeklyHeadroom`) and the week projection (`./weekSimulation.ts`), so the projection routes the way
 * the router does rather than the way somebody remembered it routing.
 */

/** How long the weekly window runs, from the reset that opened it to the reset that closes it. */
export const CODEX_WEEK_MS = 7 * 24 * 3_600_000;

/**
 * How many points a weekly window sits BELOW its level line — the line running from 0 at the reset that opened the
 * week to the plan's effective ceiling at the reset that closes it. Positive is behind, so it is spent first; negative
 * is ahead.
 *
 * @param usedPercent the weekly window's used percentage, 0..100
 * @param resetMs the epoch millisecond the window closes
 * @param nowMs the epoch millisecond the line is judged at
 * @param ceilingPercent the plan's effective weekly ceiling (`./routingCapacity.ts`'s `codexEffectiveUsageCeiling`)
 * @returns the points behind the line
 */
export function codexLevelLineHeadroom({
  ceilingPercent,
  nowMs,
  resetMs,
  usedPercent,
}: {
  ceilingPercent: number;
  nowMs: number;
  resetMs: number;
  usedPercent: number;
}): number {
  const elapsed = Math.min(Math.max((nowMs - (resetMs - CODEX_WEEK_MS)) / CODEX_WEEK_MS, 0), 1);
  return ceilingPercent * elapsed - usedPercent;
}
