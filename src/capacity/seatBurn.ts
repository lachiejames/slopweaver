/**
 * The seats the supervisor ticks saw over a span, and the plans' seven-day draw per WORKING seat-hour — the
 * timeline half of `./seatCeiling.ts`, which reads both into the fleet ceiling. Pure.
 *
 * - **Seats** hold from one tick to the next only when the next tick is at most {@link MAX_SEAT_TICK_GAP_MS}
 *   away — twice the 20-minute sweep cadence. A wider gap is UNKNOWN time: a 64-hour hole in the ticks adds to
 *   `unknownHours` and never lowers a mean.
 * - **Burn per working seat-hour** is a fleet AVERAGE: the seven-day draw of every unpaused plan, summed, over
 *   the working seat-hours, both integrated only over stretches where a tick AND every plan's samples cover
 *   the time. It attributes everything the plans drew to the seats the watch called working; it is not a
 *   per-seat measurement and does not claim one.
 */
import { parseIsoMs } from "#lib/date.js";
import type { DrawdownSample } from "../claude/drawdownAnomaly.js";

/** Seat counts hold from one tick to the next only across a gap this wide — twice the 20-minute sweep cadence. */
const MAX_SEAT_TICK_GAP_MS = 40 * 60 * 1000;

/** Two drawdown samples further apart than this are not one interval — two missed five-minute watch ticks. */
const MAX_DRAWDOWN_SAMPLE_GAP_MS = 10 * 60 * 1000;

/** Two readings whose resets lie within this many milliseconds are one window instance (as `./unused.ts`). */
const SAME_RESET_TOLERANCE_MS = 15 * 60 * 1000;

/** One hour in milliseconds. */
export const HOUR_MS = 3_600_000;

/** One supervisor tick's seat count. */
export interface SeatTickSample {
  readonly observedAtIso: string;
  /** Sessions the watch classified `working`. */
  readonly workingSeats: number;
  /** Every session the watch listed, working or not. */
  readonly openSeats: number;
}

/** The seats the ticks saw over the span. */
export interface SeatHistoryMeasurement {
  readonly samples: number;
  readonly coveredHours: number;
  readonly unknownHours: number;
  readonly widestGapSeconds: number | null;
  readonly workingSeatHours: number;
  readonly meanWorkingSeats: number | null;
  readonly peakWorkingSeats: number | null;
  readonly meanOpenSeats: number | null;
  readonly peakOpenSeats: number | null;
}

/** Plan-weeks drawn per working seat-hour, or why it could not be measured. */
export type SeatBurnMeasurement =
  | {
      readonly kind: "measured";
      /** Hours where a tick and every plan's samples covered the time together. */
      readonly overlapHours: number;
      readonly workingSeatHours: number;
      readonly planWeeksDrawn: number;
      readonly planWeeksPerWorkingSeatHour: number;
    }
  | { readonly kind: "unmeasurable"; readonly reason: string };

/** A tick with its instant parsed. */
interface TimedTick {
  readonly tick: SeatTickSample;
  readonly observedMs: number;
}

/** A seven-day sample with its instants parsed. */
interface TimedSample {
  readonly sample: DrawdownSample;
  readonly observedMs: number;
  readonly resetMs: number;
}

/** A half-open stretch of time, epoch milliseconds. */
interface Span {
  readonly startMs: number;
  readonly endMs: number;
}

/** A tick's seat counts holding over a stretch. */
interface SeatInterval extends Span {
  readonly working: number;
  readonly open: number;
}

/** One plan's utilization rising (or flat) linearly over a stretch. */
interface DrawInterval extends Span {
  readonly fromUtilization: number;
  readonly toUtilization: number;
}

/** What the overlapping stretches integrate to. */
interface OverlapTotals {
  readonly overlapMs: number;
  readonly workingSeatMs: number;
  readonly drawn: number;
}

/**
 * The ticks at or before the span's end, in instant order, plus a problem for each tick whose instant does not
 * parse. A tick after the end is never read, so a span measures exactly as it stood at its end.
 *
 * @param ticks every supervisor tick's seat counts, any order
 * @param toMs the span's end
 * @returns the kept ticks, oldest first, and what could not be counted
 */
export function timedTicksOf({ ticks, toMs }: { ticks: readonly SeatTickSample[]; toMs: number }): {
  readonly timed: readonly TimedTick[];
  readonly problems: readonly string[];
} {
  const problems: string[] = [];
  const timed: TimedTick[] = [];
  for (const tick of ticks) {
    const observedMs = parseIsoMs({ tsIso: tick.observedAtIso });
    if (observedMs === undefined) {
      problems.push(`a tick at "${tick.observedAtIso}" carries an instant that does not parse, and was not counted`);
    } else if (observedMs <= toMs) {
      timed.push({ observedMs, tick });
    }
  }
  return { problems, timed: timed.toSorted((left, right) => left.observedMs - right.observedMs) };
}

/**
 * The seven-day samples observed at or before the span's end whose instants both parse.
 *
 * @param samples every drawdown journal sample, any window, any order
 * @param toMs the span's end
 * @returns the kept samples with their instants parsed
 */
export function weeklySamplesOf({
  samples,
  toMs,
}: {
  samples: readonly DrawdownSample[];
  toMs: number;
}): readonly TimedSample[] {
  const weekly: TimedSample[] = [];
  for (const sample of samples) {
    const observedMs = parseIsoMs({ tsIso: sample.observedAtIso });
    const resetMs = parseIsoMs({ tsIso: sample.resetAtIso });
    if (sample.window === "seven-day" && observedMs !== undefined && resetMs !== undefined && observedMs <= toMs) {
      weekly.push({ observedMs, resetMs, sample });
    }
  }
  return weekly;
}

/**
 * The ticks as stretches their counts hold over, clipped to the span; a gap wider than the bound is no stretch.
 *
 * @param ticks the kept ticks, oldest first
 * @param fromMs the span's start
 * @param toMs the span's end
 * @returns the stretches, oldest first
 */
export function seatIntervalsOf({
  ticks,
  fromMs,
  toMs,
}: {
  ticks: readonly TimedTick[];
  fromMs: number;
  toMs: number;
}): readonly SeatInterval[] {
  const intervals: SeatInterval[] = [];
  for (const [index, { tick, observedMs }] of ticks.entries()) {
    const next = ticks[index + 1];
    // The newest tick holds to the bound or the span's end, whichever is first — it is the fleet as last seen.
    let endMs = Math.min(observedMs + MAX_SEAT_TICK_GAP_MS, toMs);
    if (next !== undefined) {
      if (next.observedMs - observedMs > MAX_SEAT_TICK_GAP_MS) {
        continue;
      }
      endMs = next.observedMs;
    }
    const startMs = Math.max(observedMs, fromMs);
    const clippedEnd = Math.min(endMs, toMs);
    if (clippedEnd > startMs) {
      intervals.push({ endMs: clippedEnd, open: tick.openSeats, startMs, working: tick.workingSeats });
    }
  }
  return intervals;
}

/** The widest gap between consecutive instants, whole seconds; `null` for fewer than two. */
function widestGapSecondsOf({ instantsMs }: { instantsMs: readonly number[] }): number | null {
  if (instantsMs.length < 2) {
    return null;
  }
  let widest = 0;
  for (let index = 1; index < instantsMs.length; index += 1) {
    widest = Math.max(widest, instantsMs[index]! - instantsMs[index - 1]!);
  }
  return Math.round(widest / 1000);
}

/**
 * Time-weighted seat means and sample peaks over the span.
 *
 * @param ticks the kept ticks, oldest first
 * @param intervals the stretches those ticks hold over
 * @param fromMs the span's start
 * @param toMs the span's end
 * @returns the span's seat history
 */
export function seatHistoryOf({
  ticks,
  intervals,
  fromMs,
  toMs,
}: {
  ticks: readonly TimedTick[];
  intervals: readonly SeatInterval[];
  fromMs: number;
  toMs: number;
}): SeatHistoryMeasurement {
  const inSpan = ticks.filter(({ observedMs }) => observedMs >= fromMs && observedMs <= toMs);
  const coveredMs = intervals.reduce((sum, interval) => sum + (interval.endMs - interval.startMs), 0);
  const workingMs = intervals.reduce(
    (sum, interval) => sum + interval.working * (interval.endMs - interval.startMs),
    0,
  );
  const openMs = intervals.reduce((sum, interval) => sum + interval.open * (interval.endMs - interval.startMs), 0);
  const covered = coveredMs > 0;
  const sampled = inSpan.length > 0;
  return {
    coveredHours: coveredMs / HOUR_MS,
    meanOpenSeats: covered ? openMs / coveredMs : null,
    meanWorkingSeats: covered ? workingMs / coveredMs : null,
    peakOpenSeats: sampled ? Math.max(...inSpan.map(({ tick }) => tick.openSeats)) : null,
    peakWorkingSeats: sampled ? Math.max(...inSpan.map(({ tick }) => tick.workingSeats)) : null,
    samples: inSpan.length,
    unknownHours: (toMs - fromMs - coveredMs) / HOUR_MS,
    widestGapSeconds: widestGapSecondsOf({ instantsMs: inSpan.map(({ observedMs }) => observedMs) }),
    workingSeatHours: workingMs / HOUR_MS,
  };
}

/** One plan's seven-day samples as draw intervals: same reset, close enough together, never falling. */
function drawIntervalsOf({ samples }: { samples: readonly TimedSample[] }): readonly DrawInterval[] {
  const sorted = samples.toSorted((left, right) => left.observedMs - right.observedMs);
  const intervals: DrawInterval[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const before = sorted[index - 1]!;
    const after = sorted[index]!;
    const sameReset = Math.abs(after.resetMs - before.resetMs) <= SAME_RESET_TOLERANCE_MS;
    const close = after.observedMs - before.observedMs <= MAX_DRAWDOWN_SAMPLE_GAP_MS;
    const rising = after.sample.utilization >= before.sample.utilization;
    if (sameReset && close && rising && after.observedMs > before.observedMs) {
      intervals.push({
        endMs: after.observedMs,
        fromUtilization: before.sample.utilization,
        startMs: before.observedMs,
        toUtilization: after.sample.utilization,
      });
    }
  }
  return intervals;
}

/** The interval covering `[startMs, endMs]` in a sorted, non-overlapping list, found from a moving cursor. */
function coveringFrom<T extends Span>({
  intervals,
  cursor,
  startMs,
  endMs,
}: {
  intervals: readonly T[];
  cursor: { index: number };
  startMs: number;
  endMs: number;
}): T | undefined {
  while (cursor.index < intervals.length && intervals[cursor.index]!.endMs <= startMs) {
    cursor.index += 1;
  }
  const candidate = intervals[cursor.index];
  if (candidate === undefined || candidate.startMs > startMs || candidate.endMs < endMs) {
    return undefined;
  }
  return candidate;
}

/**
 * The timeline cut at every tick and sample boundary; each piece a tick and every plan cover counts once, its
 * draw summed across plans by linear interpolation inside each plan's covering interval.
 */
function overlapTotalsOf({
  byPlan,
  seatIntervals,
  fromMs,
  toMs,
}: {
  byPlan: readonly (readonly DrawInterval[])[];
  seatIntervals: readonly SeatInterval[];
  fromMs: number;
  toMs: number;
}): OverlapTotals {
  const boundaries = new Set<number>([fromMs, toMs]);
  for (const interval of [...seatIntervals, ...byPlan.flat()]) {
    boundaries.add(interval.startMs);
    boundaries.add(interval.endMs);
  }
  const cuts = [...boundaries].filter((ms) => ms >= fromMs && ms <= toMs).toSorted((left, right) => left - right);
  const seatCursor = { index: 0 };
  const planCursors = byPlan.map(() => ({ index: 0 }));
  let overlapMs = 0;
  let workingSeatMs = 0;
  let drawn = 0;
  for (let index = 1; index < cuts.length; index += 1) {
    const startMs = cuts[index - 1]!;
    const endMs = cuts[index]!;
    const seat = coveringFrom({ cursor: seatCursor, endMs, intervals: seatIntervals, startMs });
    const covering = byPlan.map((intervals, plan) =>
      coveringFrom({ cursor: planCursors[plan]!, endMs, intervals, startMs }),
    );
    if (seat !== undefined && covering.every((interval): interval is DrawInterval => interval !== undefined)) {
      overlapMs += endMs - startMs;
      workingSeatMs += seat.working * (endMs - startMs);
      drawn += covering.reduce(
        (sum, plan) =>
          sum + ((plan.toUtilization - plan.fromUtilization) * (endMs - startMs)) / (plan.endMs - plan.startMs),
        0,
      );
    }
  }
  return { drawn, overlapMs, workingSeatMs };
}

/** Why the totals measure no burn, or `undefined` when they measure a positive, finite one. */
function unmeasurableBurnReason({ totals }: { totals: OverlapTotals }): string | undefined {
  if (totals.overlapMs === 0) {
    return "no stretch of the span had a supervisor tick and every plan's weekly readings at once";
  }
  if (totals.workingSeatMs === 0) {
    return "no seat was working while the plans were being read";
  }
  const rate = totals.drawn / (totals.workingSeatMs / HOUR_MS);
  // A positive draw can still divide to zero (subnormal) or overflow, and neither is a burn a ceiling divides by.
  if (!(rate > 0) || !Number.isFinite(rate)) {
    return "the plans drew nothing measurable while seats were working";
  }
  return undefined;
}

/**
 * Plan-weeks drawn over working seat-hours, integrated over the stretches a tick and every plan cover together.
 *
 * @param samples the kept seven-day samples
 * @param aliases the configured, unpaused Claude plans
 * @param seatIntervals the stretches the ticks' counts hold over
 * @param fromMs the span's start
 * @param toMs the span's end
 * @returns the burn, or why it could not be measured
 */
export function burnOf({
  samples,
  aliases,
  seatIntervals,
  fromMs,
  toMs,
}: {
  samples: readonly TimedSample[];
  aliases: readonly string[];
  seatIntervals: readonly SeatInterval[];
  fromMs: number;
  toMs: number;
}): SeatBurnMeasurement {
  if (aliases.length === 0) {
    return { kind: "unmeasurable", reason: "no unpaused Claude plan is configured" };
  }
  const byPlan = aliases.map((alias) =>
    drawIntervalsOf({ samples: samples.filter((timed) => timed.sample.planAlias === alias) }),
  );
  const missing = aliases.filter((_, index) => byPlan[index]!.length === 0);
  if (missing.length > 0) {
    return {
      kind: "unmeasurable",
      reason: `${missing.join(", ")} has no run of weekly readings in the span, so the plans' draw cannot be summed`,
    };
  }
  const totals = overlapTotalsOf({ byPlan, fromMs, seatIntervals, toMs });
  const reason = unmeasurableBurnReason({ totals });
  if (reason !== undefined) {
    return { kind: "unmeasurable", reason };
  }
  const workingSeatHours = totals.workingSeatMs / HOUR_MS;
  return {
    kind: "measured",
    overlapHours: totals.overlapMs / HOUR_MS,
    planWeeksDrawn: totals.drawn,
    planWeeksPerWorkingSeatHour: totals.drawn / workingSeatHours,
    workingSeatHours,
  };
}
