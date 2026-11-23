/**
 * The arithmetic `./ceilings.ts` reads every window through: a provider's raw usage as a two-decimal `used`, and a
 * set of windows as one 0..1 headroom share. Pure: numbers in, numbers out.
 *
 * Its own module because the rounding is where a reading can disagree with the gates it reports on — every router
 * compares the RAW value with `>=`, and a share rounded the wrong way reads a window the router still takes as
 * spent.
 */
import type { CeilingWindow } from "./ceilings.js";

/** A percentage to two decimals, so a 0..1 fraction scaled by 100 prints as the provider meant it. */
function round2({ value }: { value: number }): number {
  return Math.round(value * 100) / 100;
}

/**
 * A window's `used`, to two decimals, never rounded UP onto an owner's usage limit. A raw 29.9999999 under a 30%
 * usage limit is eligible at every gate; rounded to 30.00 it would read zero headroom and admit nothing. A raw value
 * at or past the line stays there, since every `available` is a whole percentage.
 *
 * A window whose `available` is the whole 100 is rounded exactly as main rounded it, edge included: a raw 99.9999999
 * still reads 100.00 and zero headroom there, so a row the owner set no limit on admits exactly as before.
 *
 * @param raw the provider's usage, already scaled to a percentage
 * @param available the share of the window this ceiling may spend — 100, or a weekly window's usage limit
 * @returns the usage to two decimals, held just under a usage limit when the raw value is under it
 */
export function usedOf({ raw, available }: { raw: number; available: number }): number {
  const rounded = round2({ value: raw });
  if (available < 100 && raw < available && rounded >= available) {
    return available - 0.01;
  }
  return rounded;
}

/** The smallest headroom {@link share} can express: what an open machine at the very edge of its hold reads as. */
export const OPEN_EDGE_HEADROOM = 0.0001;

/**
 * A headroom share clamped into 0..1 and rounded to four decimals.
 *
 * @param value the unclamped share
 * @returns the share, clamped and rounded
 */
export function share({ value }: { value: number }): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}

/**
 * The smallest per-window headroom of a set of windows.
 *
 * @param windows the windows one ceiling spends
 * @returns the tightest window's headroom share, or `null` when there are none
 */
export function windowsHeadroom({ windows }: { windows: readonly CeilingWindow[] }): number | null {
  if (windows.length === 0) {
    return null;
  }
  return share({ value: Math.min(...windows.map((window) => 1 - window.used / window.available)) });
}
