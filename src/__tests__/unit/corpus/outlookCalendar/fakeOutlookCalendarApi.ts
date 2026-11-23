/**
 * A plain fake of the `outlook-calendar` seam for the corpus tests: canned calendars, canned event pages per
 * calendar, a set of calendars whose listing fails, and a record of every `listEvents` request so the paging
 * and the filter a crawl asked for are asserted rather than assumed. A seam, not a mock.
 */
import { err, ok } from "#lib/result.js";
import type { Page, PageStart } from "../../../../live/outlook/apiCore.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import type { CalendarEventsQuery, OutlookCalendarApi } from "../../../../live/outlookCalendar/api.js";
import type { OutlookCalendarSummary } from "../../../../live/outlookCalendar/read.js";
import type { GraphCalendar, GraphEvent } from "../../../../live/outlookCalendar/wire.js";

/**
 * The paging link a fake page hands back, keyed so the next request names its calendar and page.
 *
 * @returns a Graph-hosted link the seam may follow
 */
export function fakeNextLink({ calendarId, page }: { calendarId: string; page: number }): string {
  return `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events?$skiptoken=${String(page)}`;
}

/**
 * A timed UTC event, last modified at the given instant.
 *
 * @returns the wire event
 */
export function timedEvent({
  id,
  startIso = "2001-01-08T07:00:00",
  modifiedIso,
}: {
  id: string;
  startIso?: string;
  modifiedIso?: string;
}): GraphEvent {
  return {
    end: { dateTime: "2001-01-08T08:00:00", timeZone: "UTC" },
    id,
    start: { dateTime: startIso, timeZone: "UTC" },
    subject: `Event ${id}`,
    ...(modifiedIso !== undefined ? { lastModifiedDateTime: modifiedIso } : {}),
  };
}

/**
 * The summary the listing reports for a fake calendar.
 *
 * @returns the summary
 */
export function calendarSummary({ id, isDefault = true }: { id: string; isDefault?: boolean }): OutlookCalendarSummary {
  return {
    canEdit: true,
    canViewPrivateItems: false,
    color: undefined,
    id,
    isDefault,
    name: `Calendar ${id}`,
    ownerName: undefined,
  };
}

/**
 * A fake seam over canned calendars and pages.
 *
 * @param pages each calendar's pages, in order; a calendar absent here answers one empty page
 * @param failFor calendars whose event listing answers a failure
 * @param listFails whether the calendar listing itself fails
 * @returns the seam, and every event request it was handed
 */
export function fakeOutlookCalendarApi({
  calendars,
  pages,
  failFor = new Set<string>(),
  listFails = false,
}: {
  calendars: readonly GraphCalendar[];
  pages: Readonly<Record<string, readonly (readonly GraphEvent[])[]>>;
  failFor?: ReadonlySet<string>;
  listFails?: boolean;
}): { api: OutlookCalendarApi; eventRequests: PageStart<CalendarEventsQuery>[] } {
  const eventRequests: PageStart<CalendarEventsQuery>[] = [];
  const api: OutlookCalendarApi = {
    getEvent: async () => err(OutlookErrors.apiFailed({ message: "not used by the crawl" })),
    listCalendarView: async () => err(OutlookErrors.apiFailed({ message: "not used by the crawl" })),
    listCalendars: async () => {
      if (listFails) {
        return err(OutlookErrors.apiFailed({ message: "calendar list refused" }));
      }
      return ok({ items: calendars, nextLink: undefined });
    },
    listEvents: async (requested) => {
      eventRequests.push(requested);
      const { calendarId, page } = locate({ requested });
      if (failFor.has(calendarId)) {
        return err(OutlookErrors.apiFailed({ message: "no longer accessible" }));
      }
      const own = pages[calendarId];
      const isLast = own === undefined || page >= own.length - 1;
      const result: Page<GraphEvent> = {
        items: pageItems({ own, page }),
        nextLink: isLast ? undefined : fakeNextLink({ calendarId, page: page + 1 }),
      };
      return ok(result);
    },
  };
  return { api, eventRequests };
}

/** One calendar's events on one page; a calendar with no pages, or a page past its last, holds none. */
function pageItems({
  own,
  page,
}: {
  own: readonly (readonly GraphEvent[])[] | undefined;
  page: number;
}): readonly GraphEvent[] {
  if (own === undefined) {
    return [];
  }
  const items = own[page];
  if (items === undefined) {
    return [];
  }
  return items;
}

/** Which calendar and page a request names: the first request's query, or the page the link carries. */
function locate({ requested }: { requested: PageStart<CalendarEventsQuery> }): { calendarId: string; page: number } {
  if ("first" in requested) {
    return { calendarId: requested.first.calendarId, page: 0 };
  }
  const match = /calendars\/([^/]+)\/events\?\$skiptoken=(\d+)$/u.exec(requested.link);
  if (match === null) {
    throw new Error(`fake seam handed a link it never issued: ${requested.link}`);
  }
  return { calendarId: match[1]!, page: Number(match[2]) };
}
