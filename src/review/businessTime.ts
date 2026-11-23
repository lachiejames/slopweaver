/**
 * How much BUSINESS time lies between two instants — Monday to Friday on the owner's own clock, never a weekend.
 *
 * Standing rule: only business days count, because nobody is expected to review on the weekend. So a review
 * clock never counts a Saturday or a Sunday, and a post the owner made on a Sunday night starts counting at
 * Monday's local midnight.
 *
 * ## Why the day boundary is read, never computed
 *
 * A weekday is a LOCAL fact: 23:30 Sunday in Melbourne is 13:30 Sunday UTC, but 00:30 Monday there is 14:30
 * Sunday UTC. And Melbourne's midnight moves an hour twice a year, so a fixed offset is wrong on exactly the
 * days that decide a boundary. Each local day's start is read out of `Intl.DateTimeFormat` — the same stance as
 * `../briefing/localDay.ts`, whose zone this shares so the two clocks cannot drift apart.
 *
 * Public holidays are NOT excluded: nothing in this repository names them, and a calendar guessed here would
 * be a second source of truth. A holiday counts as a business day.
 *
 * Pure — no clock of its own. Both instants are supplied.
 */
import { BRIEFING_TIME_ZONE } from "../briefing/localDay.js";

/** Milliseconds in one hour. */
const HOUR_MS = 60 * 60 * 1000;

/** Milliseconds in one business day — 24 business hours. */
export const BUSINESS_DAY_MS = 24 * HOUR_MS;

/** The local weekday and time of day. Module-scoped so the formatter is built once. */
const CLOCK_PARTS = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  second: "2-digit",
  timeZone: BRIEFING_TIME_ZONE,
  weekday: "short",
});

/** The two local weekdays a business clock skips, as `CLOCK_PARTS` spells them. */
const WEEKEND = new Set(["Sat", "Sun"]);

/**
 * One instant's local weekday, and how far it is into its local day.
 *
 * @returns the weekday's short name and the milliseconds since local midnight
 */
function localClock({ ms }: { ms: number }): { weekday: string; intoDayMs: number } {
  const parts = CLOCK_PARTS.formatToParts(new Date(ms));
  const part = ({ type }: { type: Intl.DateTimeFormatPartTypes }): string => {
    const found = parts.find((each) => each.type === type);
    if (found === undefined) {
      return "";
    }
    return found.value;
  };
  const hours = Number(part({ type: "hour" }));
  const seconds = hours * 3600 + Number(part({ type: "minute" })) * 60 + Number(part({ type: "second" }));
  return { intoDayMs: seconds * 1000 + (ms % 1000), weekday: part({ type: "weekday" }) };
}

/**
 * The next local midnight after an instant.
 *
 * Twenty-four hours past this day's midnight lands an hour off on a transition day, and the landing's own
 * local time says which way: 23:00 means the day was 25 hours long, 01:00 that it was 23.
 *
 * @returns the epoch milliseconds of the next local midnight
 */
function nextMidnight({ ms, intoDayMs }: { ms: number; intoDayMs: number }): number {
  const guess = ms - intoDayMs + BUSINESS_DAY_MS;
  const landed = localClock({ ms: guess }).intoDayMs;
  if (landed === 0) {
    return guess;
  }
  if (landed > BUSINESS_DAY_MS / 2) {
    return guess + (BUSINESS_DAY_MS - landed);
  }
  return guess - landed;
}

/**
 * The business time between two instants: every millisecond of `[from, to)` that falls on a local Monday to
 * Friday in the owner's zone.
 *
 * @param fromIso when the clock starts — a post, a reply
 * @param toIso when it is read
 * @returns the business milliseconds, `0` when `to` is not after `from`, or `undefined` when either instant is
 *   not readable — an undated clock is no clock, never zero
 */
export function businessMsBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number | undefined {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return undefined;
  }
  let total = 0;
  let at = fromMs;
  while (at < toMs) {
    const clock = localClock({ ms: at });
    const end = Math.min(nextMidnight({ intoDayMs: clock.intoDayMs, ms: at }), toMs);
    if (end <= at) {
      // A zone whose clock this cannot read would never advance; say so rather than spin.
      return undefined;
    }
    if (!WEEKEND.has(clock.weekday)) {
      total += end - at;
    }
    at = end;
  }
  return total;
}

/**
 * The first instant by which a given amount of business time has elapsed since `from` — the inverse of
 * {@link businessMsBetween}, so a clock can say WHEN it will be due and not only whether it is.
 *
 * A budget that runs out exactly at a Friday's end lands on Saturday's local midnight, the first instant
 * `businessMsBetween` reports it whole; a clock started on a weekend spends nothing until Monday.
 *
 * @param fromIso when the clock starts — an ask, a request
 * @param businessMs how much weekday time must pass
 * @returns that instant as ISO, `from` itself for a budget of zero or less, or `undefined` when `from` or the
 *   budget is not readable
 */
export function businessInstantAfter({
  fromIso,
  businessMs,
}: {
  fromIso: string;
  businessMs: number;
}): string | undefined {
  const fromMs = Date.parse(fromIso);
  if (Number.isNaN(fromMs) || !Number.isFinite(businessMs)) {
    return undefined;
  }
  let remaining = businessMs;
  let at = fromMs;
  while (remaining > 0) {
    const clock = localClock({ ms: at });
    const end = nextMidnight({ intoDayMs: clock.intoDayMs, ms: at });
    if (end <= at) {
      // A zone whose clock this cannot read would never advance; say so rather than spin.
      return undefined;
    }
    if (!WEEKEND.has(clock.weekday)) {
      const span = end - at;
      if (span >= remaining) {
        return new Date(at + remaining).toISOString();
      }
      remaining -= span;
    }
    at = end;
  }
  return new Date(at).toISOString();
}
