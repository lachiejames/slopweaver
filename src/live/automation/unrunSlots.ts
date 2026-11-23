/**
 * HOW OFTEN A ROW'S SCHEDULE WENT BY UNRUN — the number the firing history never showed.
 *
 * The slot ledger keeps one row per firing that RAN, and a late run covers only the slot it was due for
 * (`./silentRows.ts`: `missedSlots = firingsSinceWatermark - 1`), so every slot skipped on the way leaves no row at
 * all. MEASURED: `resync-corpus-slack` (every four hours) read "38 firing(s) recorded since
 * <instant>: 33 ok, 1 failed, 3 dead" — four breaks in 38 runs — over a span its cadence fires about 138
 * times in. Asked "is that common", the honest answer is that most of its schedule never ran, and the page could not
 * say it. Repro: `slopweaver automation status`, then count the cadence's firings since the oldest recorded slot.
 *
 * The count is every scheduled time after the oldest recorded firing, up to now, with no firing row — except the
 * newest one when it is simply DUE and not yet run, which has not gone by. It walks the cadence at most
 * {@link UNRUN_WALK_CAP} + 2 times, deciding at most {@link UNRUN_WALK_CAP} + 1 of them, so a minutely row over months costs a bounded walk and says "at least" rather
 * than a number it did not count. Pure: the cadence, the recorded slots and an instant in.
 */
import { CronExpressionParser } from "cron-parser";

/**
 * The most scheduled times one count walks. The same ceiling `./firingCalculus.ts` puts on a missed-firing count,
 * and for the same reason: a row this far behind is not made clearer by a bigger number.
 */
const UNRUN_WALK_CAP = 1000;

/** How many scheduled times went by with no firing row, and whether that count is whole or a floor. */
export interface UnrunSlots {
  readonly count: number;
  readonly bound: "exact" | "at-least";
}

/**
 * Count the scheduled times since the oldest recorded firing that went by with no firing row.
 *
 * @param cadence the row's five-field cron expression
 * @param slotIsos every slot the ledger holds a firing row for, any order; the oldest is the count's start
 * @param nowIso the instant the count runs to
 * @returns the count and its bound, or `null` when there is no recorded firing to count from or the cadence will not
 *   parse — an unparseable cadence is `UNSCHEDULABLE` elsewhere, never a zero here
 */
export function unrunSlotsOf({
  cadence,
  slotIsos,
  nowIso,
}: {
  cadence: string;
  slotIsos: readonly string[];
  nowIso: string;
}): UnrunSlots | null {
  const recorded = new Set(slotIsos.map((iso) => Date.parse(iso)));
  if (recorded.size === 0) {
    return null;
  }
  const oldestMs = Math.min(...recorded);
  let iterator;
  try {
    iterator = CronExpressionParser.parse(cadence, { currentDate: new Date(oldestMs) });
  } catch {
    return null;
  }
  const nowMs = Date.parse(nowIso);
  let unrun = 0;
  // The newest time at or before now is DUE until a later one at or before now proves it went by, so each time is
  // counted only when the next one arrives — and the one still pending when the walk ends is never counted.
  let pending: number | null = null;
  for (let walked = 0; walked <= UNRUN_WALK_CAP + 1; walked += 1) {
    const next = iterator.next().getTime();
    if (next > nowMs) {
      return { bound: "exact", count: unrun };
    }
    if (pending !== null && !recorded.has(pending)) {
      unrun += 1;
    }
    pending = next;
  }
  return { bound: "at-least", count: unrun };
}
