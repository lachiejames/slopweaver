/**
 * The two halves of ONE calendar's `freebusy.query` entry, read apart: the errors Google raised instead of
 * saying, and the busy periods it did say. `free.ts`'s `parseAvailability` joins them into the availability record, and
 * owns what an entry the response omitted entirely means; this file reads only an entry that is there.
 *
 * Pure: no I/O, no clock.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import { parseIsoMs } from "../../lib/date.js";

/**
 * Why Google would not say, one reason per error it raised for this calendar, in Google's order. Google sends
 * `errors` only "if computation for the calendar failed" (its own field documentation), so an entry without
 * them (omitted, or `null`) is one Google answered, and has no reason to give.
 *
 * @param entry Google's entry for one calendar
 * @returns each error's reason; empty when Google answered for the calendar
 */
export function freeBusyErrorReasons({ entry }: { entry: calendar_v3.Schema$FreeBusyCalendar }): readonly string[] {
  if (entry.errors == null) {
    return [];
  }
  return entry.errors.map((error) => errorReason({ error }));
}

/**
 * One error's reason. The SDK declares `reason` optional, and an error Google raised without naming why is
 * still a refusal: it reads as `unknown`, so the calendar is still reported as one that would not say.
 */
function errorReason({ error }: { error: calendar_v3.Schema$Error }): string {
  if (error.reason == null) {
    return "unknown";
  }
  return error.reason;
}

/**
 * The busy periods Google reported, as epoch-millisecond intervals in Google's order, unmerged. `busy` is the
 * list of time ranges during which the calendar "should be regarded as busy", so an entry without it
 * (omitted, or `null`) reports no busy period. No recording here shows Google omitting it on a calendar with
 * nothing booked. A period missing either bound, or carrying one that is not an instant, is not an interval
 * and is left out.
 *
 * @param entry Google's entry for one calendar
 * @returns every busy period with two readable bounds
 */
export function busyPeriods({
  entry,
}: {
  entry: calendar_v3.Schema$FreeBusyCalendar;
}): readonly { readonly startMs: number; readonly endMs: number }[] {
  if (entry.busy == null) {
    return [];
  }
  const busy: { startMs: number; endMs: number }[] = [];
  for (const period of entry.busy) {
    const startMs = period.start == null ? undefined : parseIsoMs({ tsIso: period.start });
    const endMs = period.end == null ? undefined : parseIsoMs({ tsIso: period.end });
    if (startMs !== undefined && endMs !== undefined) {
      busy.push({ endMs, startMs });
    }
  }
  return busy;
}
