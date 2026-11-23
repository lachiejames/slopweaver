/**
 * `calendar free` — the availability read: which stretches of a window are open across the owner's own
 * calendar and the people the owner names, computed from Google's busy intervals rather than asked of Google.
 *
 * ## Free is arithmetic, and the arithmetic is where the honesty lives
 *
 * `freebusy.query` answers with BUSY intervals per calendar, or a typed error per calendar. Everything
 * else here is pure: merge the busy intervals of every calendar into one set, take the gaps inside the
 * window, clip each gap to the hours the caller asked for (in the zone the caller reads in), and keep the
 * gaps at least as long as the meeting. Three consequences are residue lines rather than footnotes:
 *
 * - **A calendar that refused makes common availability UNKNOWN, not free.** Google reports a colleague
 *   whose calendar is not shared as an error entry, and a reader who took that as "no busy blocks" would
 *   book straight over their day. So one refusal empties the slot list and the residue names the calendar.
 * - **A slot is an observation, not a reservation.** Nothing here holds it, and it can be gone by the time
 *   a booking is proposed.
 * - **Working hours are the caller's to state.** With no `--between`, the whole day is a candidate,
 *   including 03:00; the door does not invent a working week.
 *
 * ## The zone
 *
 * A gap is an interval of instants and needs no zone. Clipping to "09:00–17:00" does, because those are
 * wall-clock times on each local day, and so does rendering. The zone is resolved by the SHELL — the
 * account's own from `settings.get`, or `--zone` — and passed in, so this file stays pure and the offset
 * arithmetic is done once, in `zoneClock.ts`, through `Intl.DateTimeFormat`, with a second pass for the DST
 * edge where the first guess lands on the wrong side of a transition.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import { parseIsoMs } from "../../lib/date.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import type { CalendarError } from "./errors.js";
import { CalendarErrors } from "./errors.js";
import { type CalendarFreeBusyApi, MAX_FREEBUSY_CALENDARS } from "./freeApi.js";
import { busyPeriods, freeBusyErrorReasons } from "./freeBusyEntry.js";
import { type DailyHours, renderInZone, renderMinute } from "./wallClockText.js";
import { DAY_MS, localMidnightOfUtcDate, localMinuteToMs, MINUTE_MS } from "./zoneClock.js";

/** One half-open interval of instants, `[startMs, endMs)`. */
export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

/** What Google said about one calendar: its busy intervals, or why it would not say. */
export interface CalendarAvailability {
  readonly calendarId: string;
  readonly busy: readonly Interval[];
  /** Google's own reason when the calendar could not be read — `notFound`, or a sharing refusal. */
  readonly error: string | undefined;
}

/**
 * The payload of a `calendar free` document.
 *
 * @internal — the declared shape of `readCalendarFree`'s typed payload; callers reach it through `CalendarFreeResult`.
 */
export interface CalendarFree {
  readonly account: string;
  readonly zone: string;
  /** The window actually asked of Google: the caller's dates, bounded at local midnight in `zone`. */
  readonly timeMinIso: string;
  readonly timeMaxIso: string;
  readonly minutes: number;
  readonly between: DailyHours | undefined;
  readonly calendars: readonly CalendarAvailability[];
  /** The open stretches common to every calendar, or undefined when any calendar refused. */
  readonly slots: readonly Interval[] | undefined;
}

/** A free read: the shared document AND the typed payload. */
export interface CalendarFreeResult {
  readonly document: ProviderReadDocument;
  readonly free: CalendarFree;
}

/**
 * Snap a UTC-day window onto the same calendar dates read as LOCAL days in `zone`.
 *
 * `resolveWindow` produces UTC midnights, which is right for `list` (Google is asked in instants) and wrong
 * for a slot search: "the next three days" starting at UTC midnight is 10:00 in Melbourne, so the first local
 * morning would be missing from the answer. The dates the caller named are kept; only the instants they
 * bound move to local midnight.
 *
 * @param window the UTC-day window `resolveWindow` produced
 * @param zone an IANA zone name
 * @returns the window on local midnights, or the input unchanged when the zone is unknown
 */
export function snapWindowToLocalDays({ window, zone }: { window: Interval; zone: string }): Interval {
  const startMs = localMidnightOfUtcDate({ utcDayMs: window.startMs, zone });
  const endMs = localMidnightOfUtcDate({ utcDayMs: window.endMs, zone });
  if (startMs === undefined || endMs === undefined) {
    return window;
  }
  return { endMs, startMs };
}

/**
 * Merge overlapping and touching intervals into a sorted, disjoint set.
 *
 * @param intervals any intervals, in any order
 * @returns the disjoint union, ordered by start
 */
export function mergeIntervals({ intervals }: { intervals: readonly Interval[] }): readonly Interval[] {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .toSorted((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.startMs <= last.endMs) {
      merged[merged.length - 1] = { endMs: Math.max(last.endMs, interval.endMs), startMs: last.startMs };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/**
 * The gaps between busy intervals inside a window.
 *
 * @param busy the merged busy set
 * @param window the bounds the gaps are confined to
 * @returns every open stretch, ordered by start
 */
export function gapsWithin({ busy, window }: { busy: readonly Interval[]; window: Interval }): readonly Interval[] {
  const gaps: Interval[] = [];
  let cursor = window.startMs;
  for (const interval of mergeIntervals({ intervals: busy })) {
    if (interval.endMs <= cursor) {
      continue;
    }
    if (interval.startMs >= window.endMs) {
      break;
    }
    if (interval.startMs > cursor) {
      gaps.push({ endMs: Math.min(interval.startMs, window.endMs), startMs: cursor });
    }
    cursor = Math.max(cursor, interval.endMs);
  }
  if (cursor < window.endMs) {
    gaps.push({ endMs: window.endMs, startMs: cursor });
  }
  return gaps;
}

/**
 * Clip gaps to a wall-clock window on each local day of `zone`.
 *
 * @param gaps the open stretches
 * @param between the daily hours, or undefined for no clipping
 * @param zone the zone the hours are read in
 * @returns the pieces of each gap that fall inside the hours, ordered by start
 */
export function clipToDailyHours({
  gaps,
  between,
  zone,
}: {
  gaps: readonly Interval[];
  between: DailyHours | undefined;
  zone: string;
}): readonly Interval[] {
  if (between === undefined) {
    return gaps;
  }
  const clipped: Interval[] = [];
  for (const gap of gaps) {
    // HALF-day steps, not whole ones. A 24-hour step from an arbitrary instant can land on the same local
    // date twice or SKIP one outright when the clock moves: walking the same UTC hour each day across Melbourne's
    // spring-forward transition goes from the day before to the day after, and the missing day's hours were silently dropped
    // from the answer. Stepping by half a day cannot skip a local day, and the duplicate visits merge away.
    for (let dayMs = gap.startMs - DAY_MS; dayMs < gap.endMs + DAY_MS; dayMs += DAY_MS / 2) {
      const open = localMinuteToMs({ dayMs, minute: between.startMinute, zone });
      const close = localMinuteToMs({ dayMs, minute: between.endMinute, zone });
      if (open === undefined || close === undefined) {
        return gaps;
      }
      const startMs = Math.max(gap.startMs, open);
      const endMs = Math.min(gap.endMs, close);
      if (endMs > startMs) {
        clipped.push({ endMs, startMs });
      }
    }
  }
  return mergeIntervals({ intervals: clipped });
}

/**
 * Keep the gaps long enough for a meeting of `minutes`.
 *
 * @param gaps the open stretches
 * @param minutes the meeting length
 * @returns the gaps at least that long
 */
export function slotsOfAtLeast({ gaps, minutes }: { gaps: readonly Interval[]; minutes: number }): readonly Interval[] {
  return gaps.filter((gap) => gap.endMs - gap.startMs >= minutes * MINUTE_MS);
}

/**
 * Read Google's per-calendar answer into this door's shape, keeping an error as a fact about that calendar.
 *
 * @param calendarId the id the request named
 * @param entry Google's entry for it, or undefined when the response omitted the calendar
 * @returns the availability record
 */
export function parseAvailability({
  calendarId,
  entry,
}: {
  calendarId: string;
  entry: calendar_v3.Schema$FreeBusyCalendar | undefined;
}): CalendarAvailability {
  if (entry === undefined) {
    return { busy: [], calendarId, error: "the response carried no entry for this calendar" };
  }
  const reasons = freeBusyErrorReasons({ entry });
  return {
    busy: mergeIntervals({ intervals: busyPeriods({ entry }) }),
    calendarId,
    error: reasons.length === 0 ? undefined : reasons.join(", "),
  };
}

/**
 * The residue every free read prints — the things a reader would otherwise assume away.
 *
 * @param free the computed payload
 * @param zoneEstablished whether the zone came from the account rather than a default
 * @returns the residue lines
 */
function freeResidue({ free, zoneEstablished }: { free: CalendarFree; zoneEstablished: boolean }): readonly string[] {
  const refused = free.calendars.filter((c) => c.error !== undefined);
  return [
    "a slot is an observation at read time, not a reservation — it can be gone before a booking is proposed",
    `this is ONE window across ${String(free.calendars.length)} calendar(s); a person not named is not consulted`,
    free.between === undefined
      ? "no --between hours were asked for, so every hour of every day is a candidate, nights included"
      : `slots are clipped to ${renderMinute({ minute: free.between.startMinute })}–${renderMinute({ minute: free.between.endMinute })} on each local day in ${free.zone}`,
    ...(zoneEstablished
      ? []
      : [`the account's own time zone was not established, so hours and rendering use ${free.zone}`]),
    ...(refused.length === 0
      ? []
      : [
          `common availability is UNKNOWN: ${refused.map((c) => `${c.calendarId} (${String(c.error)})`).join("; ")} — a calendar that refused is not a free one`,
        ]),
    "a busy interval says only that the hour is taken, never by what; a calendar shared as free/busy only reads the same as one shared in full",
  ];
}

/**
 * Compute the common free slots across every calendar in a window.
 *
 * @param api the injected free/busy seam
 * @param account the Google account the grant bound to
 * @param calendarIds every calendar to consult, the owner's own included
 * @param timeMinIso the window's inclusive start as a UTC day bound; re-read as that date's local midnight
 * @param timeMaxIso the window's exclusive end as a UTC day bound; re-read the same way
 * @param minutes the meeting length a slot must fit
 * @param between the daily hours slots are clipped to, or undefined for the whole day
 * @param zone the IANA zone hours and rendering are read in
 * @param zoneEstablished whether that zone is the account's own rather than a fallback
 * @param nowIso the read timestamp source
 * @returns the free document and its typed payload, or the typed reason the read failed
 */
export async function readCalendarFree({
  api,
  account,
  calendarIds,
  timeMinIso,
  timeMaxIso,
  minutes,
  between,
  zone,
  zoneEstablished,
  nowIso,
}: {
  api: CalendarFreeBusyApi;
  account: string;
  calendarIds: readonly string[];
  timeMinIso: string;
  timeMaxIso: string;
  minutes: number;
  between: DailyHours | undefined;
  zone: string;
  zoneEstablished: boolean;
  nowIso: () => string;
}): Promise<Result<CalendarFreeResult, CalendarError>> {
  const window = resolveFreeWindow({ calendarIds, timeMaxIso, timeMinIso, zone });
  if (window.isErr()) {
    return err(window.error);
  }
  const { startMs: windowStartMs, endMs: windowEndMs } = window.value;
  const response = await api.queryFreeBusy({
    calendarIds,
    timeMaxIso: new Date(windowEndMs).toISOString(),
    timeMinIso: new Date(windowStartMs).toISOString(),
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const free = computeFree({
    account,
    between,
    calendarIds,
    minutes,
    response: response.value,
    window: { endMs: windowEndMs, startMs: windowStartMs },
    zone,
  });
  return ok({
    document: {
      coverage: {
        detail: coverageDetail({ free, window: { endMs: windowEndMs, startMs: windowStartMs } }),
        kind: "bounded",
        residue: freeResidue({ free, zoneEstablished }),
      },
      data: free,
      readAtIso: nowIso(),
      source: "calendar",
      target: { address: calendarIds.join(","), identity: account, kind: "free/busy window" },
    },
    free,
  });
}

/**
 * Check the request's bounds and re-anchor its UTC-day window on local midnights.
 *
 * @param calendarIds every calendar the read will name — capped at Google's own request limit
 * @returns the local-day window, or the typed reason the request cannot be made
 */
function resolveFreeWindow({
  calendarIds,
  timeMinIso,
  timeMaxIso,
  zone,
}: {
  calendarIds: readonly string[];
  timeMinIso: string;
  timeMaxIso: string;
  zone: string;
}): Result<Interval, CalendarError> {
  if (calendarIds.length > MAX_FREEBUSY_CALENDARS) {
    return err(
      CalendarErrors.apiFailed({
        cause: undefined,
        message: `free/busy takes at most ${String(MAX_FREEBUSY_CALENDARS)} calendars in one read; ${String(calendarIds.length)} were named`,
      }),
    );
  }
  const utcStartMs = parseIsoMs({ tsIso: timeMinIso });
  const utcEndMs = parseIsoMs({ tsIso: timeMaxIso });
  if (utcStartMs === undefined || utcEndMs === undefined) {
    return err(
      CalendarErrors.apiFailed({ cause: undefined, message: `unreadable window: ${timeMinIso} → ${timeMaxIso}` }),
    );
  }
  return ok(snapWindowToLocalDays({ window: { endMs: utcEndMs, startMs: utcStartMs }, zone }));
}

/**
 * The pure core: Google's answer plus the window in, the typed payload out.
 *
 * @param response what `freebusy.query` returned
 * @param window the local-day window the query was made over
 * @returns the payload, with `slots` undefined whenever any calendar refused
 */
function computeFree({
  account,
  between,
  calendarIds,
  minutes,
  response,
  window,
  zone,
}: {
  account: string;
  between: DailyHours | undefined;
  calendarIds: readonly string[];
  minutes: number;
  response: calendar_v3.Schema$FreeBusyResponse;
  window: Interval;
  zone: string;
}): CalendarFree {
  const calendars = calendarIds.map((calendarId) =>
    parseAvailability({ calendarId, entry: response.calendars?.[calendarId] }),
  );
  const anyRefused = calendars.some((c) => c.error !== undefined);
  const slots = anyRefused
    ? undefined
    : slotsOfAtLeast({
        gaps: clipToDailyHours({ between, gaps: gapsWithin({ busy: calendars.flatMap((c) => c.busy), window }), zone }),
        minutes,
      });
  return {
    account,
    between,
    calendars,
    minutes,
    slots,
    timeMaxIso: new Date(window.endMs).toISOString(),
    timeMinIso: new Date(window.startMs).toISOString(),
    zone,
  };
}

/** The one-line coverage statement: how many stretches, or that none can be stated. */
function coverageDetail({ free, window }: { free: CalendarFree; window: Interval }): string {
  if (free.slots === undefined) {
    return `common availability not established across ${String(free.calendars.length)} calendar(s)`;
  }
  return (
    `${String(free.slots.length)} open stretch(es) of at least ${String(free.minutes)} min across ` +
    `${String(free.calendars.length)} calendar(s) between ${renderInZone({ atMs: window.startMs, zone: free.zone })} ` +
    `and ${renderInZone({ atMs: window.endMs, zone: free.zone })} ${free.zone}`
  );
}
