/**
 * Which ISO week a value sample belongs to. Pure: the instant is always supplied.
 *
 * The week is read off the owner's LOCAL day (`../briefing/localDay.ts`), never the UTC one: the standing row fires
 * Monday morning on this machine, which is still Sunday by UTC's reckoning, so a UTC week would file Monday's sample
 * under the week before and a retry after midday UTC would draw a second sample for the same Monday.
 */
import { localDayKey } from "../briefing/localDay.js";

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * The ISO 8601 week a `YYYY-MM-DD` day falls in, as `YYYY-Www` — the year being the week's own, which differs
 * from the day's at either end of December and January.
 *
 * @param day the calendar day, `YYYY-MM-DD`
 * @returns the week id, or `undefined` when the day does not parse
 */
export function isoWeekOfDay({ day }: { day: string }): string | undefined {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || Number.isNaN(ms)) {
    return undefined;
  }
  const date = new Date(ms);
  // Monday is 0. The week belongs to the year its Thursday falls in.
  const weekday = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(ms + (3 - weekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const ordinal = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS);
  const week = Math.floor(ordinal / 7) + 1;
  return `${String(year)}-W${String(week).padStart(2, "0")}`;
}

/**
 * The ISO week an instant falls in on the owner's local calendar.
 *
 * @param nowIso the instant
 * @returns the week id, or `undefined` when the instant does not parse
 */
export function sampleWeekOf({ nowIso }: { nowIso: string }): string | undefined {
  return isoWeekOfDay({ day: localDayKey({ iso: nowIso }) });
}
