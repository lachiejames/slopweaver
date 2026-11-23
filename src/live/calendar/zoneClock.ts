/**
 * The zone clock: a zone's offset at an instant, and the instant a wall-clock minute names on a local day.
 *
 * A gap between busy intervals is an interval of instants and needs no zone. "09:00 on each local day" does,
 * and so does "this date's local midnight", so this is where a wall-clock time becomes an instant — done once,
 * through `Intl.DateTimeFormat`, with the DST edge handled where it actually falls. `free.ts` clips and snaps
 * windows with it; the status-expiry and snooze readers ask it for one local minute each.
 *
 * Pure: no I/O, no clock — every instant is the caller's.
 */

/** Milliseconds in a minute. */
export const MINUTE_MS = 60_000;

/** Milliseconds in a day. */
export const DAY_MS = 86_400_000;

/**
 * The offset of a zone from UTC at one instant, in milliseconds — positive east of Greenwich.
 *
 * @param atMs the instant
 * @param zone an IANA zone name
 * @returns the offset, or undefined when the zone is not one `Intl` knows
 */
export function zoneOffsetMs({ atMs, zone }: { atMs: number; zone: string }): number | undefined {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: zone,
      year: "numeric",
    }).formatToParts(new Date(atMs));
  } catch {
    return undefined;
  }
  // Every one of the six fields read here was asked of the formatter above, and `formatToParts` returns a part
  // for every field it was asked for, so the part is always there.
  const field = ({ type }: { type: Intl.DateTimeFormatPartTypes }): number =>
    Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(
    field({ type: "year" }),
    field({ type: "month" }) - 1,
    field({ type: "day" }),
    field({ type: "hour" }),
    field({ type: "minute" }),
    field({ type: "second" }),
  );
  return asUtc - Math.floor(atMs / 1000) * 1000;
}

/**
 * The instant of a wall-clock minute on the local day that contains `dayMs`, in `zone`.
 *
 * An ordinary minute resolves to itself, a minute a fall-back repeats to its first occurrence, and a minute a
 * spring-forward deletes to the transition.
 *
 * @param dayMs any instant inside the local day
 * @param minute minutes from local midnight
 * @param zone an IANA zone name
 * @returns the instant, or undefined when the zone is unknown
 */
export function localMinuteToMs({
  dayMs,
  minute,
  zone,
}: {
  dayMs: number;
  minute: number;
  zone: string;
}): number | undefined {
  const firstOffset = zoneOffsetMs({ atMs: dayMs, zone });
  if (firstOffset === undefined) {
    return undefined;
  }
  const localMidnightUtc = Math.floor((dayMs + firstOffset) / DAY_MS) * DAY_MS;
  const wantedLocalMinute = (localMidnightUtc + minute * MINUTE_MS) / MINUTE_MS;
  // Offsets span -12h to +14h, so the answer is inside a 26-hour window around the wall-clock instant, and the
  // offsets in force at its two ends are the only two a single DST transition inside it can produce. Each
  // offset names one candidate instant; a candidate is real when its own local clock reads the minute asked for.
  // An ordinary minute has one real candidate; an AMBIGUOUS minute (the hour a fall-back repeats) has two, and
  // the earlier — its first occurrence — is the answer.
  const windowStart = wantedLocalMinute - (14 * 60 + 1);
  const windowEnd = wantedLocalMinute + (12 * 60 + 1);
  const candidates: number[] = [];
  for (const edge of [windowStart, windowEnd]) {
    const offset = zoneOffsetMs({ atMs: edge * MINUTE_MS, zone });
    if (offset === undefined) {
      return undefined;
    }
    candidates.push(wantedLocalMinute - offset / MINUTE_MS);
  }
  const real = candidates.filter(
    (candidate) => localMinutesSinceEpoch({ atMs: candidate * MINUTE_MS, zone }) === wantedLocalMinute,
  );
  if (real.length > 0) {
    return Math.min(...real) * MINUTE_MS;
  }
  return springForwardBoundary({ wantedLocalMinute, windowEnd, windowStart, zone });
}

/**
 * The instant a minute the spring-forward gap DELETES resolves to: the transition itself — 02:30 on a
 * spring-forward day in Melbourne is 03:00, the first moment that exists, not 03:30 an hour along and not 01:30 an hour back.
 * Neither offset's candidate lands on the transition, so only the boundary between them is right: the EARLIEST
 * instant whose local clock has passed the minute asked for. Local time only moves forward across a
 * spring-forward, so inside the window that boundary is found by bisection.
 */
function springForwardBoundary({
  wantedLocalMinute,
  windowStart,
  windowEnd,
  zone,
}: {
  wantedLocalMinute: number;
  windowStart: number;
  windowEnd: number;
  zone: string;
}): number | undefined {
  let low = windowStart;
  let high = windowEnd;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const reached = localMinutesSinceEpoch({ atMs: mid * MINUTE_MS, zone });
    if (reached === undefined) {
      return undefined;
    }
    if (reached >= wantedLocalMinute) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low * MINUTE_MS;
}

/**
 * How many minutes of LOCAL clock time have passed in a zone at an instant. It steps BACK across a fall-back,
 * which is why {@link localMinuteToMs} bisects only once it knows the window holds a spring-forward instead.
 *
 * @param atMs the instant
 * @param zone an IANA zone name
 * @returns local minutes since the epoch, or undefined when the zone is unknown
 */
function localMinutesSinceEpoch({ atMs, zone }: { atMs: number; zone: string }): number | undefined {
  const offset = zoneOffsetMs({ atMs, zone });
  // No offset means `Intl` does not know the zone (or the instant is past the Date range): there is no local
  // clock to count minutes on, so `localMinuteToMs` answers undefined rather than guessing an instant.
  if (offset === undefined) {
    return undefined;
  }
  return Math.floor((atMs + offset) / MINUTE_MS);
}

/**
 * Local midnight, in `zone`, of the calendar date a UTC midnight names.
 *
 * Reads the date off the UTC instant and re-anchors it, so a zone up to fourteen hours either side of
 * Greenwich lands on the same date rather than the neighbouring one; the second offset pass covers a DST
 * transition sitting between the guess and the answer.
 *
 * @param utcDayMs a UTC midnight
 * @param zone an IANA zone name
 * @returns the instant of that date's local midnight, or undefined when the zone is unknown
 */
export function localMidnightOfUtcDate({ utcDayMs, zone }: { utcDayMs: number; zone: string }): number | undefined {
  const firstOffset = zoneOffsetMs({ atMs: utcDayMs, zone });
  if (firstOffset === undefined) {
    return undefined;
  }
  const guess = utcDayMs - firstOffset;
  const secondOffset = zoneOffsetMs({ atMs: guess, zone });
  // The zone already answered once, so the second pass fails only when the guess itself is no instant a `Date`
  // can hold — within a day of the representable range's edge. There is no DST transition to correct for out
  // there, and the first pass's guess is the answer.
  if (secondOffset === undefined) {
    return guess;
  }
  return utcDayMs - secondOffset;
}
