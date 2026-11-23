/**
 * The free/busy seam — the ONE call `calendar free` makes, kept apart from {@link ./api.CalendarApi} so the
 * read builders' plain-object fakes never have to grow a method they do not use.
 *
 * `freebusy.query` is a POST that names up to fifty calendars and answers, per calendar, either a list of
 * busy intervals or a typed error. It does not answer "free": free is what a caller computes from the busy
 * intervals and the window it asked about, which is why the seam returns Google's shape and the pure half
 * (`free.ts`) does the arithmetic.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import type { Result } from "../../lib/result.js";
import { type CalendarError, CalendarErrors } from "./errors.js";

/** The most calendars one `freebusy.query` may name — Google's own ceiling on the request. */
export const MAX_FREEBUSY_CALENDARS = 50;

/** The one call `calendar free` makes. Injected, so the slot builder never needs a live account. */
export interface CalendarFreeBusyApi {
  readonly queryFreeBusy: (args: {
    /** The inclusive lower bound, RFC3339. */
    timeMinIso: string;
    /** The exclusive upper bound, RFC3339. */
    timeMaxIso: string;
    /** The calendar ids to ask about — an account's own is its email address, or `primary`. */
    calendarIds: readonly string[];
  }) => Promise<Result<calendar_v3.Schema$FreeBusyResponse, CalendarError>>;
}

/** Map a boundary failure into this domain's own union at the point it is consumed, carrying the cause. */
function toCalendarError({ error }: { error: IngestError }): CalendarError {
  return CalendarErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * The production free/busy seam, bound to one resolved grant.
 *
 * @param client the `@googleapis/calendar` surface
 * @param account the account the grant bound to, hashed into the shared 429 rate scope
 * @returns the one call `calendar free` makes
 */
export function makeCalendarFreeBusyApi({
  client,
  account,
}: {
  client: calendar_v3.Calendar;
  account: string;
}): CalendarFreeBusyApi {
  const scopeId = scopeIdForToken({ token: account });
  return {
    queryFreeBusy: async ({ timeMinIso, timeMaxIso, calendarIds }) =>
      safeProviderCall({
        execute: () =>
          client.freebusy.query({
            requestBody: {
              items: calendarIds.map((id) => ({ id })),
              timeMax: timeMaxIso,
              timeMin: timeMinIso,
            },
          }),
        operation: "calendar.freebusy.query",
        provider: "calendar",
        retryMode: "transient",
        scopeId,
      })
        .map((response) => response.data)
        .mapErr((error) => toCalendarError({ error })),
  };
}
