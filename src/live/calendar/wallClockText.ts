/**
 * Wall-clock text: `HH:MM-HH:MM` read into daily hours, and minutes or an instant written back as what a reader sees.
 *
 * Pure: no I/O, no clock — every instant is the caller's.
 */

/** A wall-clock window on each local day, minutes from midnight, `[startMinute, endMinute)`. */
export interface DailyHours {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Render minutes-from-midnight as `HH:MM`.
 *
 * @param minute minutes from local midnight
 * @returns the wall-clock text
 */
export function renderMinute({ minute }: { minute: number }): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parse `HH:MM-HH:MM` into daily hours.
 *
 * @param text the flag value
 * @returns the hours, or undefined when the text is not two ascending wall-clock times
 */
export function parseDailyHours({ text }: { text: string }): DailyHours | undefined {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const startMinute = Number(match[1]) * 60 + Number(match[2]);
  const endMinute = Number(match[3]) * 60 + Number(match[4]);
  const valid =
    Number(match[1]) < 24 &&
    Number(match[2]) < 60 &&
    Number(match[3]) <= 24 &&
    Number(match[4]) < 60 &&
    endMinute > startMinute;
  return valid ? { endMinute, startMinute } : undefined;
}

/**
 * Render an instant as local wall-clock text in a zone, `YYYY-MM-DD Day HH:MM`.
 *
 * @param atMs the instant
 * @param zone an IANA zone name
 * @returns the text, or the ISO instant when the zone is unknown
 */
export function renderInZone({ atMs, zone }: { atMs: number; zone: string }): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: zone,
      weekday: "short",
      year: "numeric",
    }).formatToParts(new Date(atMs));
    const get = ({ type }: { type: Intl.DateTimeFormatPartTypes }): string =>
      parts.find((part) => part.type === type)!.value;
    return `${get({ type: "year" })}-${get({ type: "month" })}-${get({ type: "day" })} ${get({ type: "weekday" })} ${get({ type: "hour" })}:${get({ type: "minute" })}`;
  } catch {
    return new Date(atMs).toISOString();
  }
}
