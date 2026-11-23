/**
 * UTC calendar-day arithmetic for the problem badge — pure, no clock.
 *
 * A day is a `YYYY-MM-DD` string and every comparison is in whole UTC days, so the 15-day boundary means the
 * same thing wherever the door that stamped the body ran.
 */

/** Milliseconds in one UTC day. */
const DAY_MS = 86_400_000;

/** English month abbreviations, as the badge and the Before-and-after cell print them. */
const MONTHS: readonly string[] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The `YYYY-MM-DD` shape, before the calendar check. */
const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The UTC midnight a day names, or undefined when the string is not a real calendar day.
 *
 * A 30th of February has the right shape and is refused: `Date.UTC` rolls it into March, and the read-back of the
 * parts is what notices.
 *
 * @param day the candidate `YYYY-MM-DD` string
 * @returns milliseconds since the epoch at that day's UTC midnight, or undefined
 */
export function utcMidnightOf({ day }: { day: string }): number | undefined {
  const match = DAY_SHAPE.exec(day);
  if (match === null) {
    return undefined;
  }
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = Date.UTC(year, month - 1, date);
  const back = new Date(at);
  const same = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === date;
  return same ? at : undefined;
}

/**
 * The UTC calendar day an instant falls on — how the door turns its clock into a write stamp.
 *
 * @param instant the moment, from the caller's injected clock
 * @returns the `YYYY-MM-DD` UTC day
 */
export function utcDayOf({ instant }: { instant: Date }): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Whole UTC days from one real day to a later one; negative when `from` is after `to`.
 *
 * @param from the earlier day, already known to be real
 * @param to the later day, already known to be real
 * @returns the signed whole-day distance
 */
export function daysBetween({ from, to }: { from: number; to: number }): number {
  return Math.round((to - from) / DAY_MS);
}

/**
 * A real day as the badge prints it: day of the month, then the month abbreviation.
 *
 * @param day a real `YYYY-MM-DD` day
 * @returns the day of the month without a leading zero, then the month abbreviation
 */
export function shortDay({ day }: { day: string }): string {
  const [, month, date] = day.split("-");
  return `${String(Number(date))} ${MONTHS[Number(month) - 1]!}`;
}

/**
 * A real day as the Before-and-after cell prints it: the short day, then the year.
 *
 * @param day a real `YYYY-MM-DD` day
 * @returns the short day followed by the four-digit year
 */
export function longDay({ day }: { day: string }): string {
  return `${shortDay({ day })} ${day.slice(0, 4)}`;
}

/**
 * The inverse of {@link longDay}: the printed long day back to `YYYY-MM-DD`.
 *
 * @param text the long day as printed
 * @returns the real `YYYY-MM-DD` day, or undefined when the text is not one
 */
export function isoOfLongDay({ text }: { text: string }): string | undefined {
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(text);
  const month = match === null ? -1 : MONTHS.indexOf(match[2]!);
  if (match === null || month < 0) {
    return undefined;
  }
  const day = `${match[3]!}-${String(month + 1).padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
  return utcMidnightOf({ day }) === undefined || longDay({ day }) !== text ? undefined : day;
}
