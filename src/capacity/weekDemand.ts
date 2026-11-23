/**
 * A provider's trailing demand on its weekly windows, read off the `machine capacity` readings the chair tick files —
 * the honest series for a provider with no drawdown journal of its own (Codex keeps none on this install; the readings
 * ledger carries every plan's weekly window, every 20–40 minutes).
 *
 * ## How a draw is counted
 *
 * Per plan, between two consecutive readings that both measured its weekly window:
 *
 * - **Same window** (the reset instant moved by at most {@link SAME_WINDOW_TOLERANCE_MS}): the draw is how far `used`
 *   rose past the highest value this window has shown. Measured against the HIGH-WATER mark, never the previous
 *   reading, so a reading that dips and recovers is never counted twice.
 * - **A new window** (the reset moved forward and the new week opened no earlier than the previous reading): the whole
 *   of the new `used` was drawn inside the interval. That covers both a natural reset and a free reset claim, which
 *   restarts the week at the claim instant.
 * - **Anything else** (the reset moved backward, or to a week that opened before the previous reading): the baseline
 *   restarts with no draw. A window the series cannot account for is never read as demand.
 *
 * A plan absent from a reading (unreadable, paused) carries its baseline across the gap, so its draw lands when it is
 * next measured. A reading that measured no window of the asked-for kind is skipped whole: it neither starts nor
 * extends the span, so another kind's readings can never make a short series look long enough. Hours the machine was off add span and no draw, which reads demand LOW — the safe side for a
 * warning whose cost is a false positive.
 *
 * Pure: the series in, a rate or a reason out.
 */
import { parseIsoMs } from "#lib/date.js";

import type { Ceiling } from "./ceilings.js";

/** How far a window's reset instant may wander between readings and still be the same window: ten minutes. */
const SAME_WINDOW_TOLERANCE_MS = 10 * 60_000;

/** One week, the span a weekly window opens before its reset. */
const WEEK_MS = 7 * 24 * 3_600_000;

/** A full diurnal cycle: a series shorter than this reads a day's peak or trough as its rate. */
export const MIN_DEMAND_SPAN_HOURS = 24;

/** One filed reading of the plans' ceilings, in the order the ledger holds it. */
export interface DemandPoint {
  readonly observedAtIso: string;
  readonly ceilings: readonly Ceiling[];
}

/** What a series says about trailing demand. */
export type WeekDemand =
  | {
      readonly kind: "measured";
      /** Points of a weekly window drawn per hour, summed across the provider's plans. */
      readonly pointsPerHour: number;
      readonly spanHours: number;
      readonly readings: number;
    }
  | { readonly kind: "unmeasurable"; readonly why: string };

/** One plan's baseline across the series. */
interface Baseline {
  highWater: number;
  resetMs: number;
  observedMs: number;
}

/**
 * One plan's weekly window at one reading, or undefined when that reading did not measure it: an unreadable plan, a
 * window with no reset, or a label two windows share, since nothing says which of them is the plan's week.
 */
function weeklyOf({
  ceiling,
  window,
}: {
  ceiling: Ceiling;
  window: string;
}): { used: number; resetMs: number } | undefined {
  const [measured, ...others] = ceiling.windows.filter((candidate) => candidate.window === window);
  if (measured?.resetAtIso == null || others.length > 0 || ceiling.status === "unreadable") {
    return undefined;
  }
  const resetMs = parseIsoMs({ tsIso: measured.resetAtIso });
  if (resetMs === undefined) {
    return undefined;
  }
  return { resetMs, used: measured.used };
}

/**
 * The draw one plan's reading adds to the series, given the baseline before it.
 *
 * @param baseline the plan's baseline before this reading
 * @param used the weekly window's used percentage at this reading
 * @param resetMs the weekly window's reset at this reading
 * @returns the points drawn, and whether this reading continues, opens or restarts the plan's window
 */
function drawOf({ baseline, resetMs, used }: { baseline: Baseline; resetMs: number; used: number }): {
  drawn: number;
  highWater: number;
} {
  if (Math.abs(resetMs - baseline.resetMs) <= SAME_WINDOW_TOLERANCE_MS) {
    return { drawn: Math.max(0, used - baseline.highWater), highWater: Math.max(baseline.highWater, used) };
  }
  const openedMs = resetMs - WEEK_MS;
  const openedInsideTheInterval =
    resetMs > baseline.resetMs && openedMs >= baseline.observedMs - SAME_WINDOW_TOLERANCE_MS;
  if (openedInsideTheInterval) {
    return { drawn: Math.max(0, used), highWater: used };
  }
  return { drawn: 0, highWater: used };
}

/** Every plan of `kind` whose `window` this one reading measured. */
function windowsOf({
  kind,
  point,
  window,
}: {
  kind: Ceiling["kind"];
  point: DemandPoint;
  window: string;
}): readonly { id: string; weekly: { used: number; resetMs: number } }[] {
  return point.ceilings.flatMap((ceiling) => {
    const weekly = ceiling.kind === kind ? weeklyOf({ ceiling, window }) : undefined;
    return weekly === undefined ? [] : [{ id: ceiling.id, weekly }];
  });
}

/** The draw one reading's windows add, moving each plan's baseline in `baselines` up to this reading. */
function drawAcross({
  baselines,
  observedMs,
  windows,
}: {
  baselines: Map<string, Baseline>;
  observedMs: number;
  windows: readonly { id: string; weekly: { used: number; resetMs: number } }[];
}): number {
  let drawn = 0;
  for (const { id, weekly } of windows) {
    const baseline = baselines.get(id);
    let highWater = weekly.used;
    if (baseline !== undefined) {
      const step = drawOf({ baseline, resetMs: weekly.resetMs, used: weekly.used });
      drawn += step.drawn;
      highWater = step.highWater;
    }
    baselines.set(id, { highWater, observedMs, resetMs: weekly.resetMs });
  }
  return drawn;
}

/**
 * A provider's trailing demand on one window label, from a series of filed readings.
 *
 * @param points the filed readings, oldest first
 * @param kind which provider's ceilings to read
 * @param window the window label whose draw is demand (`weekly` for Codex)
 * @returns the points drawn per hour across the series' span, or why the series cannot say
 */
export function trailingWeekDemand({
  kind,
  points,
  window,
}: {
  kind: Ceiling["kind"];
  points: readonly DemandPoint[];
  window: string;
}): WeekDemand {
  const baselines = new Map<string, Baseline>();
  let drawn = 0;
  const spanned: number[] = [];
  for (const point of points) {
    const observedMs = parseIsoMs({ tsIso: point.observedAtIso });
    const previousMs = spanned.at(-1);
    const outOfOrder = observedMs === undefined || (previousMs !== undefined && observedMs < previousMs);
    const windows = outOfOrder ? [] : windowsOf({ kind, point, window });
    // Only a reading that measured this kind's window spans its history; another kind's reading says nothing of it.
    if (observedMs === undefined || windows.length === 0) {
      continue;
    }
    spanned.push(observedMs);
    drawn += drawAcross({ baselines, observedMs, windows });
  }
  const firstMs = spanned[0];
  const lastMs = spanned.at(-1);
  if (firstMs === undefined || lastMs === undefined || baselines.size === 0) {
    return { kind: "unmeasurable", why: `no filed reading measured a ${kind} plan's ${window} window` };
  }
  const spanHours = (lastMs - firstMs) / 3_600_000;
  if (spanHours < MIN_DEMAND_SPAN_HOURS) {
    return {
      kind: "unmeasurable",
      why: `the filed readings span ${spanHours.toFixed(1)}h, under the ${String(MIN_DEMAND_SPAN_HOURS)}h a trailing rate needs`,
    };
  }
  return { kind: "measured", pointsPerHour: drawn / spanHours, readings: spanned.length, spanHours };
}
