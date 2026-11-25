/**
 * Which stored grant a calendar verb reads over — the ONE decision, which `session.ts` binds with, kept pure so it
 * is stated and tested once rather than re-derived beside every read.
 *
 * The calendar is its own integration with its own consent (`outlook-calendar connect`) and its own grant file.
 * A mail grant consented before that split may already carry `Calendars.Read`; that grant keeps working for
 * the calendar until a calendar grant of its own is stored. The order, and why each step is where it is:
 *
 * 1. **The calendar's own grant always wins**, even beside a mail grant that also covers the calendar: it is the
 *    consent the owner gave for this product.
 * 2. **An own grant short of the calendar's read is refused**, never passed over for the mail grant: falling
 *    through would hide a calendar consent that went wrong behind one that happens to work.
 * 3. **With no own grant, a mail grant covering the calendar is used** — the held wider grant.
 * 4. **Otherwise the calendar is not connected**, naming `outlook-calendar connect`. A mail grant without the
 *    calendar's read is not the calendar's grant falling short, so it is `NOT_CONNECTED`, not `SCOPE_MISSING`.
 *
 * Pure: no I/O, no clock.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { OutlookGrant } from "../../secrets/outlookGrant.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import { mailGrantCoversCalendar, missingOutlookScopes } from "./scopes.js";

/** The grant a calendar verb binds over, and which product's file it came from — the file a refresh rewrites. */
export interface OutlookCalendarGrantChoice {
  readonly source: "calendar" | "mail";
  readonly grant: OutlookGrant;
}

/**
 * Choose the grant a calendar verb reads over.
 *
 * @param calendarGrant the calendar's own stored grant, or `undefined` when none is stored
 * @param mailGrant the mail grant, or `undefined` when none is stored; consulted only when the calendar has none
 * @returns the chosen grant and its source, or `SCOPE_MISSING`/`NOT_CONNECTED` naming `outlook-calendar connect`
 */
export function chooseOutlookCalendarGrant({
  calendarGrant,
  mailGrant,
}: {
  calendarGrant: OutlookGrant | undefined;
  mailGrant: OutlookGrant | undefined;
}): Result<OutlookCalendarGrantChoice, OutlookError> {
  if (calendarGrant !== undefined) {
    const missing = missingOutlookScopes({ capabilities: ["calendar"], granted: calendarGrant.scopes });
    if (missing.length > 0) {
      return err(OutlookErrors.scopeMissing({ granted: calendarGrant.scopes, missing, product: "calendar" }));
    }
    return ok({ grant: calendarGrant, source: "calendar" });
  }
  if (mailGrant !== undefined && mailGrantCoversCalendar({ granted: mailGrant.scopes })) {
    return ok({ grant: mailGrant, source: "mail" });
  }
  return err(OutlookErrors.notConnected({ product: "calendar" }));
}
