/**
 * The one reader of a `ps -o lstart=` stamp taken under `TZ=UTC LC_ALL=C` — `Fri Oct  9 11:36:11 2026`.
 *
 * Strict on purpose: a caller deciding that a process started AFTER some instant must never be handed an instant the
 * stamp does not name. `Date.UTC` rolls an impossible stamp (day 31 of February, `25:00`) into a real, later one, and the
 * weekday is a fifth field that has to agree with the date, so every field is read back off the instant built and
 * a stamp whose read-back differs is no stamp.
 */

/** `ps -o lstart=` under the C locale: weekday, month, day (space-padded), clock, year. */
const LSTART = /^\s*([A-Z][a-z]{2})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/u;

/** The C locale's month abbreviations, in order. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The C locale's weekday abbreviations, Sunday first as `getUTCDay` counts. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * A `ps -o lstart=` stamp taken under UTC, as epoch milliseconds.
 *
 * @param text the stamp, e.g. `Fri Oct  9 11:36:11 2026`
 * @returns the instant to the second, or `undefined` when the text is not such a stamp or names no real instant —
 *   a day the month lacks, a clock past `23:59:59`, or a weekday the date does not fall on
 */
export function lstartMs({ text }: { text: string }): number | undefined {
  const match = LSTART.exec(text);
  if (match === null) {
    return undefined;
  }
  const weekday = WEEKDAYS.findIndex((name) => name === match[1]);
  const month = MONTHS.findIndex((name) => name === match[2]);
  if (weekday < 0 || month < 0) {
    return undefined;
  }
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  const year = Number(match[7]);
  const at = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  const exact =
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hours &&
    at.getUTCMinutes() === minutes &&
    at.getUTCSeconds() === seconds &&
    at.getUTCDay() === weekday;
  return exact ? at.getTime() : undefined;
}
