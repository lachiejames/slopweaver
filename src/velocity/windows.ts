/**
 * Trailing-window day buckets shared by every velocity measurement, so a merge count, a landing count and
 * a turn count all bucket against the SAME calendar days rather than three independently-rounded windows
 * that could disagree by one day at the edge.
 *
 * Pure: `nowIso` is injected, and the arithmetic leans entirely on `../lib/date.js` rather than
 * reimplementing UTC calendar maths a third time in this repo.
 */
import { parseYyyyMmDdUtcMs, yyyyMmDdMinusDays, yyyyMmDdTodayPlus } from "../lib/date.js";

/** One calendar day's bounds, UTC. `[sinceIso, untilIso)` — `untilIso` is the NEXT day's midnight. */
export interface DayWindow {
  /** `YYYY-MM-DD`, this window's own day. */
  readonly dayKey: string;
  readonly sinceIso: string;
  readonly untilIso: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The trailing `days` UTC calendar days ending today (today's own window included, oldest first).
 *
 * @param nowIso the reference instant (the shell injects the real clock)
 * @param days how many trailing days to bucket
 * @returns one window per day, oldest first
 */
export function trailingDayWindows({ nowIso, days }: { nowIso: string; days: number }): readonly DayWindow[] {
  const now = new Date(nowIso);
  const today = yyyyMmDdTodayPlus({ days: 0, now });
  const windows: DayWindow[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const dayKey = yyyyMmDdMinusDays({ date: today, days: offset });
    const sinceMs = parseYyyyMmDdUtcMs({ date: dayKey });
    if (sinceMs === undefined) {
      continue;
    }
    windows.push({
      dayKey,
      sinceIso: new Date(sinceMs).toISOString(),
      untilIso: new Date(sinceMs + MS_PER_DAY).toISOString(),
    });
  }
  return windows;
}

/**
 * The whole period a set of windows spans — the first window's start to the last window's end. `undefined`
 * only when `windows` is empty, which never happens for a positive `days`.
 *
 * @param windows the day windows to span
 * @returns the combined `[sinceIso, untilIso)` bound, or `undefined` for an empty list
 */
export function spanOf({
  windows,
}: {
  windows: readonly DayWindow[];
}): { sinceIso: string; untilIso: string } | undefined {
  const first = windows[0];
  const last = windows[windows.length - 1];
  return first === undefined || last === undefined ? undefined : { sinceIso: first.sinceIso, untilIso: last.untilIso };
}
