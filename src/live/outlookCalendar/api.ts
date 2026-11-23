/**
 * The `outlook-calendar` door's Graph seam: four reads, each one Graph call inside `safeProviderCall`,
 * `transient`, through its strict boundary (`./wire.ts`). Built over the Graph client `../outlook/session.ts`
 * bound to the ONE Microsoft grant, so the calendar has no token path of its own.
 *
 * Three properties every request has, two of them the mail door's (`../outlook/apiCore.ts` header):
 *
 * - **`Prefer: IdType="ImmutableId"`**, paging links included, so an event id read today names the same event
 *   after it is moved between calendars.
 * - **A paging link is followed only when it points at Graph**, because following it sends the owner's bearer.
 * - **`Prefer: outlook.timezone="UTC"`**, so every `dateTime` Graph answers is UTC and a timed event parses to an
 *   instant without a Windows-zone table. The zone the event was AUTHORED in still arrives, as
 *   `originalStartTimeZone`. The window bounds of a `calendarView` carry their own offset and are NOT read
 *   through this header (Microsoft's `calendarView` page says so), so the door always sends them as UTC instants.
 */
import { safeProviderCall, scopeIdForToken } from "#lib/providerCall.js";
import { err, type Result } from "#lib/result.js";
import {
  checked,
  failed,
  followable,
  type Page,
  type PageStart,
  PREFER_IMMUTABLE,
  segment,
} from "../outlook/apiCore.js";
import type { GraphClient } from "../outlook/client.js";
import type { OutlookError } from "../outlook/errors.js";
import { rethrowGraph } from "../outlook/graphThrow.js";
import { CALENDAR_PAGE, EVENT, EVENT_PAGE, type GraphCalendar, type GraphEvent, type GraphEventRead } from "./wire.js";

/** The rate-limit registry entry every call is paced against — the same Microsoft account as the mail door. */
const PROVIDER = "outlook";

/** Sent on every calendar request — see this file's header. */
const PREFER_CALENDAR = `${PREFER_IMMUTABLE}, outlook.timezone="UTC"`;

/** Sent on an event read that carries a body, so no verb renders stored HTML. */
const PREFER_CALENDAR_TEXT = `${PREFER_CALENDAR}, outlook.body-content-type="text"`;

/** What a listing selects: enough to show a row, never a body. */
const EVENT_SUMMARY_SELECT: readonly string[] = [
  "id",
  "subject",
  "start",
  "end",
  "isAllDay",
  "isCancelled",
  "showAs",
  "sensitivity",
  "type",
  "seriesMasterId",
  "location",
  "organizer",
  "isOrganizer",
  "responseStatus",
  "isOnlineMeeting",
  "onlineMeeting",
  "webLink",
];

/** What a full read, and the corpus crawl, select: the summary plus the body, attendees and recurrence. */
const EVENT_FULL_SELECT: readonly string[] = [
  ...EVENT_SUMMARY_SELECT,
  "body",
  "attendees",
  "recurrence",
  "categories",
  "importance",
  "iCalUId",
  "createdDateTime",
  "lastModifiedDateTime",
  "originalStartTimeZone",
  "originalEndTimeZone",
  "hasAttachments",
  "onlineMeetingUrl",
];

/** What a calendar listing selects. */
const CALENDAR_SELECT: readonly string[] = [
  "id",
  "name",
  "color",
  "isDefaultCalendar",
  "canEdit",
  "canViewPrivateItems",
  "owner",
];

/** A window over one calendar, or over the default one when `calendarId` is absent. */
export interface CalendarViewQuery {
  readonly calendarId: string | undefined;
  readonly startIso: string;
  readonly endIso: string;
  readonly top: number;
}

/** Every event stored on one calendar, unexpanded: single events and series masters. */
export interface CalendarEventsQuery {
  readonly calendarId: string;
  readonly top: number;
  /** Only events Microsoft last changed at or after this instant; undefined reads every stored event. */
  readonly modifiedSinceIso: string | undefined;
}

/**
 * The `$filter` that narrows a stored-events listing to what changed since an instant. Graph's OData takes a
 * bare `DateTimeOffset` literal, unquoted. Pure.
 *
 * @param modifiedSinceIso the instant, an ISO-8601 UTC string
 * @returns the filter expression
 */
function modifiedSinceFilter({ modifiedSinceIso }: { modifiedSinceIso: string }): string {
  return `lastModifiedDateTime ge ${modifiedSinceIso}`;
}

/** The `outlook-calendar` door's Graph seam. Every method answers a boundary-checked wire value or the typed failure. */
export interface OutlookCalendarApi {
  /** `GET /me/calendars` — every calendar the account holds or was shared. */
  readonly listCalendars: (args: PageStart<{ top: number }>) => Promise<Result<Page<GraphCalendar>, OutlookError>>;
  /** `calendarView` — the window EXPANDED into occurrences, in start order. */
  readonly listCalendarView: (args: PageStart<CalendarViewQuery>) => Promise<Result<Page<GraphEvent>, OutlookError>>;
  /** `/me/calendars/{id}/events` — what is STORED: single events and series masters, never their occurrences. */
  readonly listEvents: (args: PageStart<CalendarEventsQuery>) => Promise<Result<Page<GraphEvent>, OutlookError>>;
  /** One event in full, with the link naming the calendar that holds it. */
  readonly getEvent: (args: { eventId: string }) => Promise<Result<GraphEventRead, OutlookError>>;
}

/** The path a window is read on. */
function calendarViewPath({ calendarId }: { calendarId: string | undefined }): string {
  if (calendarId === undefined) {
    return "/me/calendarView";
  }
  return `/me/calendars/${segment({ id: calendarId })}/calendarView`;
}

/**
 * Build the production seam over one bound Graph client.
 *
 * @param graph the client `../outlook/session.ts` bound to the grant
 * @param rateScopeKey the bound account, which the shared 429 block counts against
 * @returns the {@link OutlookCalendarApi} every verb and the corpus crawl call
 */
// max-lines-exempt: one object literal of four endpoint arms over one bound client, the shape `../outlook/apiRead.ts` takes; each arm is one `safeProviderCall` and one boundary check.
export function makeOutlookCalendarApi({
  graph,
  rateScopeKey,
}: {
  graph: GraphClient;
  rateScopeKey: string;
}): OutlookCalendarApi {
  // Every read is a GET a replay lands the same way, paced against the bound account.
  const paced = {
    provider: PROVIDER,
    retryMode: "transient",
    scopeId: scopeIdForToken({ token: rateScopeKey }),
  } as const;
  return {
    getEvent: async ({ eventId }) => {
      const result = await safeProviderCall({
        ...paced,
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/events/${segment({ id: eventId })}`)
            .select([...EVENT_FULL_SELECT])
            .expand("calendar")
            .header("Prefer", PREFER_CALENDAR_TEXT)
            .get()
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.calendar.events.get",
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: EVENT, operation: "outlook.calendar.events.get", value: result.value });
    },
    listCalendarView: async (requested) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      const result = await safeProviderCall({
        ...paced,
        execute: (): Promise<unknown> => {
          const request =
            "link" in start
              ? graph.api(start.link)
              : graph
                  .api(calendarViewPath({ calendarId: start.first.calendarId }))
                  .query({ endDateTime: start.first.endIso, startDateTime: start.first.startIso })
                  .select([...EVENT_SUMMARY_SELECT])
                  .orderby("start/dateTime")
                  .top(start.first.top);
          return request
            .header("Prefer", PREFER_CALENDAR)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        operation: "outlook.calendar.view.list",
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: EVENT_PAGE, operation: "outlook.calendar.view.list", value: result.value }).map(
        (page) => ({
          items: page.value,
          nextLink: page["@odata.nextLink"],
        }),
      );
    },
    listCalendars: async (requested) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      const result = await safeProviderCall({
        ...paced,
        execute: (): Promise<unknown> => {
          const request =
            "link" in start
              ? graph.api(start.link)
              : graph
                  .api("/me/calendars")
                  .select([...CALENDAR_SELECT])
                  .top(start.first.top);
          return request
            .header("Prefer", PREFER_IMMUTABLE)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        operation: "outlook.calendar.calendars.list",
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({
        boundary: CALENDAR_PAGE,
        operation: "outlook.calendar.calendars.list",
        value: result.value,
      }).map((page) => ({
        items: page.value,
        nextLink: page["@odata.nextLink"],
      }));
    },
    listEvents: async (requested) => {
      const allowed = followable({ start: requested });
      if (allowed.isErr()) {
        return err(allowed.error);
      }
      const start = allowed.value;
      const result = await safeProviderCall({
        ...paced,
        execute: (): Promise<unknown> => {
          if ("link" in start) {
            return graph
              .api(start.link)
              .header("Prefer", PREFER_CALENDAR_TEXT)
              .get()
              .catch((error: unknown) => rethrowGraph({ error }));
          }
          const { calendarId, modifiedSinceIso, top } = start.first;
          const listing = graph
            .api(`/me/calendars/${segment({ id: calendarId })}/events`)
            .select([...EVENT_FULL_SELECT])
            .top(top);
          // A paging link carries the filter itself, so only the first request names it.
          const narrowed =
            modifiedSinceIso === undefined ? listing : listing.filter(modifiedSinceFilter({ modifiedSinceIso }));
          return narrowed
            .header("Prefer", PREFER_CALENDAR_TEXT)
            .get()
            .catch((error: unknown) => rethrowGraph({ error }));
        },
        operation: "outlook.calendar.events.list",
      });
      if (result.isErr()) {
        return err(failed({ error: result.error }));
      }
      return checked({ boundary: EVENT_PAGE, operation: "outlook.calendar.events.list", value: result.value }).map(
        (page) => ({
          items: page.value,
          nextLink: page["@odata.nextLink"],
        }),
      );
    },
  };
}
