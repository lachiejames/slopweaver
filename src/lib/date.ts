/**
 * Date/epoch conversions that had been reimplemented across refresh, the Slack + Notion connectors, and
 * the silver/retrieval recency helpers. Pure — the "now" is injected (never `new Date()` inside), so the
 * window arithmetic is unit-testable against a fixed clock. All calendar maths is UTC.
 */

/** Milliseconds in one second — the epoch-scaling factor `epochSecondsToIso` owns for the whole repo. */
const MS_PER_SECOND = 1000;

/** ECMAScript's own outer bound for a `Date`: ±8.64e15 ms. Beyond it `new Date` is `Invalid Date`. */
const MAX_TIME_VALUE_MS = 8.64e15;

/** `YYYY-MM-DD` for the UTC calendar day of `date`. */
function toYyyyMmDd({ date }: { date: Date }): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The UTC calendar day `days` from `now`, as `YYYY-MM-DD` — the refresh window's "today ± N" bound. Pure:
 * `now` is injected and never mutated. Preserves the old `setUTCDate` + `toISOString().slice(0,10)` shape.
 *
 * @param now the reference instant (the shell injects the real clock)
 * @param days the offset in days (negative for the past)
 * @returns the offset day as `YYYY-MM-DD`
 */
export function yyyyMmDdTodayPlus({ now, days }: { now: Date; days: number }): string {
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return toYyyyMmDd({ date });
}

/**
 * `days` before a `YYYY-MM-DD` date, as `YYYY-MM-DD`. Pure.
 *
 * @param date the anchor day (`YYYY-MM-DD`)
 * @param days how many days before it
 * @returns the earlier day as `YYYY-MM-DD`
 */
export function yyyyMmDdMinusDays({ date, days }: { date: string; days: number }): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return toYyyyMmDd({ date: parsed });
}

/**
 * A `YYYY-MM-DD` day bound → ms since epoch at UTC midnight, or `undefined` when unparseable. Pure —
 * the Notion cutoff + Slack window bounds both start here.
 *
 * @param date the `YYYY-MM-DD` bound
 * @returns UTC-midnight ms, or `undefined` if not a finite date
 */
export function parseYyyyMmDdUtcMs({ date }: { date: string }): number | undefined {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * A `YYYY-MM-DD` day bound → whole epoch seconds at UTC midnight, or `undefined` when unparseable (the
 * Slack `oldest`/`latest` bound; the caller supplies its own fallback string). Pure.
 *
 * @param date the `YYYY-MM-DD` bound
 * @returns floored epoch seconds, or `undefined` if not a finite date
 */
export function yyyyMmDdToEpochSeconds({ date }: { date: string }): number | undefined {
  const ms = parseYyyyMmDdUtcMs({ date });
  return ms === undefined ? undefined : Math.floor(ms / 1000);
}

/**
 * An ISO-8601 timestamp → ms since epoch, or `undefined` when unparseable — the recency helpers' invalid
 * convention (callers that want 0 coalesce with `?? 0`). Pure.
 *
 * @param tsIso the ISO timestamp
 * @returns ms since epoch, or `undefined`
 */
export function parseIsoMs({ tsIso }: { tsIso: string }): number | undefined {
  const ms = Date.parse(tsIso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** `YYYY-MM-DDTHH:MM:SS`, at most three fraction digits, then `Z` or `±HH:MM` — nothing else names one instant. */
const STRICT_ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/u;

/**
 * An ISO-8601 instant → ms since epoch, refusing everything `Date.parse` would guess at: a bare number, a date with
 * no time, a time with no zone (read as local), a fraction finer than a millisecond (floored), and a calendar
 * impossibility such as day 30 of February. Pure.
 *
 * @param text the candidate instant
 * @returns ms since epoch, or `undefined` when `text` is not exactly one instant to the millisecond
 */
export function parseStrictIsoInstantMs({ text }: { text: string }): number | undefined {
  const match = STRICT_ISO_INSTANT.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second, fraction, zulu, sign, offsetHour, offsetMinute] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  let ms = 0;
  if (fraction !== undefined) {
    ms = Number(fraction.padEnd(3, "0"));
  }
  // `setUTCFullYear`, never `Date.UTC`: that reads a year 0–99 as 1900–1999.
  const utc = new Date(0);
  utc.setUTCFullYear(y, mo - 1, d);
  utc.setUTCHours(h, mi, s, ms);
  const sameCalendar =
    utc.getUTCFullYear() === y &&
    utc.getUTCMonth() === mo - 1 &&
    utc.getUTCDate() === d &&
    utc.getUTCHours() === h &&
    utc.getUTCMinutes() === mi &&
    utc.getUTCSeconds() === s;
  if (!sameCalendar) {
    return undefined;
  }
  if (zulu !== undefined) {
    return utc.getTime();
  }
  const offsetH = Number(offsetHour);
  const offsetM = Number(offsetMinute);
  if (offsetH > 23 || offsetM > 59) {
    return undefined;
  }
  let direction = 1;
  if (sign === "-") {
    direction = -1;
  }
  return utc.getTime() - direction * (offsetH * 60 + offsetM) * 60_000;
}

/**
 * Epoch SECONDS → an ISO-8601 instant. The one conversion every provider's numeric time field goes through.
 *
 * Exists so the `epoch-arithmetic` gate in `yarn lint` has a single named destination to point every
 * `new Date(x * 1000)` at — see `./slackTs.ts`'s module header for the 80-minute hand-conversion that made a
 * scattered conversion a gated one.
 *
 * @param seconds whole or fractional seconds since the epoch
 * @returns the instant, or `undefined` when `seconds` is not a finite number
 */
export function epochSecondsToIso({ seconds }: { seconds: number }): string | undefined {
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  const ms = seconds * MS_PER_SECOND;
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_VALUE_MS ? new Date(ms).toISOString() : undefined;
}

/**
 * A timestamp capped at the clock that read it — the ONE "nothing can have been read past now" rule.
 *
 * A cursor answers how far through TIME a source has been read, so a cursor ahead of the clock claims a span
 * nobody could have read; used as a lower bound it then skips everything between the clock and it. That
 * failure has now been found on three lanes — calendar, Slack and the pooled watermark itself
 * — and the reason it kept recurring is that each lane wrote its own comparison, so no rule had a single
 * function to name. This is that function; `../corpus/slack/reach.ts#noLaterThanClock` stays separate
 * because it compares Slack epoch SECONDS, which is a different unit rather than a fourth copy.
 *
 * Milliseconds rather than string order, because the two operands are different SHAPES: a cursor is a bare
 * `YYYY-MM-DD` whenever it came from a window end and an instant otherwise. Comparing them as strings
 * happens to be right (a day is a prefix of its own midnight instant) and is exactly the kind of right that
 * stops being right. Either side unparseable clamps nothing — a broken clock is no evidence about a cursor.
 * Pure.
 *
 * @param tsIso the timestamp to cap — an observed instant, or a window end standing in for one
 * @param nowIso the instant the pass ran, which is as far through time as reading anything can prove
 * @returns `tsIso`, or `nowIso` when `tsIso` is ahead of it
 */
export function clampIsoToClock({ tsIso, nowIso }: { tsIso: string; nowIso: string }): string {
  const tsMs = parseIsoMs({ tsIso });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (tsMs === undefined || nowMs === undefined) {
    return tsIso;
  }
  return tsMs > nowMs ? nowIso : tsIso;
}
