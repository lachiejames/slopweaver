/**
 * The Google Calendar API SEAM — the narrow set of calls this door makes, and the production implementation
 * that routes each one through the paced provider door.
 *
 * The seam is deliberately smaller than `calendar_v3`. A verb asks for "the calendars this account
 * subscribes to" or "the events in this window"; it does not get a whole SDK surface to reach into, which
 * is what keeps the document builders in `read.ts` pure enough to test with plain object fakes instead of a
 * live account.
 *
 * ## `singleEvents` is a CALLER's choice, and the two callers choose differently
 *
 * With `singleEvents: true` Google expands a recurring event into its instances; with `false` it returns the
 * recurring MASTER carrying its `recurrence` rule, plus any instance that was individually changed. Both are
 * correct and they answer different questions, so the flag is on the seam rather than fixed inside it:
 *
 * - the DOOR expands (`calendar list` means "what is on next Tuesday", and a human means instances);
 * - a future CORPUS lane will not (bronze is the lossless capture, expansion is a projection, and an
 *   unbounded expansion of a daily standup is thousands of near-identical records for one decision).
 *
 * That second point is also a bound, which is why the flag exists now rather than later: a full sync with
 * `singleEvents: true` and no `timeMax` asks Google to expand every recurrence in the account's history,
 * which is the one shape here with no natural ceiling.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type CalendarError, CalendarErrors } from "./errors.js";

/** One calendar the account subscribes to, as `calendarList.list` reports it. */
export interface CalendarSummary {
  /** The id every other call addresses this calendar by. The account's own is its email address. */
  readonly id: string;
  readonly summary: string | undefined;
  readonly description: string | undefined;
  /** The IANA zone the calendar's own floating times are read in. */
  readonly timeZone: string | undefined;
  /** `owner`, `writer`, `reader` or `freeBusyReader` — what this grant can do with it. */
  readonly accessRole: string | undefined;
  /** Whether this is the account's own primary calendar rather than one it merely subscribes to. */
  readonly primary: boolean;
  /** Whether the owner has this calendar ticked in the Google Calendar interface. */
  readonly selected: boolean;
}

/** One page of events, plus whichever cursor Google returned to continue from. */
export interface CalendarEventPage {
  readonly events: readonly calendar_v3.Schema$Event[];
  /** The page cursor. Present ⇒ another page of THIS listing follows. */
  readonly nextPageToken: string | undefined;
  /**
   * The delta cursor, returned only on the LAST page of a listing. Present ⇒ everything up to this point
   * has been served, and a later call carrying it returns only what changed since.
   */
  readonly nextSyncToken: string | undefined;
  /** The calendar's own default time zone, as this listing reports it. */
  readonly timeZone: string | undefined;
}

/** The calls the Calendar verbs make. Injected, so a document builder never needs a live account. */
export interface CalendarApi {
  /** Every calendar the account subscribes to, one page at a time. */
  readonly listCalendars: (args: {
    pageToken?: string | undefined;
  }) => Promise<Result<{ calendars: readonly CalendarSummary[]; nextPageToken: string | undefined }, CalendarError>>;
  /**
   * List events in ONE calendar, either by time window or by sync token — never both, because Google refuses
   * `timeMin`/`timeMax`/`orderBy` alongside a `syncToken` and returns undefined results if the parameters a
   * token was minted under change underneath it.
   */
  readonly listEvents: (args: {
    calendarId: string;
    /** The inclusive lower bound, RFC3339. Absent with a `syncToken`, required without one. */
    timeMinIso?: string | undefined;
    /** The exclusive upper bound, RFC3339. */
    timeMaxIso?: string | undefined;
    /** Google's delta cursor from a previous listing's `nextSyncToken`. */
    syncToken?: string | undefined;
    /** Google's page cursor from a previous page's `nextPageToken`. */
    pageToken?: string | undefined;
    /** Whether to expand recurring events into instances — see this file's header. */
    singleEvents: boolean;
    /** Whether cancelled events are reported. A delta lane needs them; a human listing does not. */
    showDeleted: boolean;
    /** How many events to ask for in one page. */
    limit: number;
  }) => Promise<Result<CalendarEventPage, CalendarError>>;
  /** Fetch one event by id from one calendar. */
  readonly getEvent: (args: {
    calendarId: string;
    eventId: string;
  }) => Promise<Result<calendar_v3.Schema$Event, CalendarError>>;
  /**
   * The account's own default time zone.
   *
   * Read through `settings.get` rather than inferred from a calendar, because an all-day event carries no
   * zone of its own and "Tuesday" is only a real instant once one is known.
   */
  readonly getTimeZone: () => Promise<Result<string | undefined, CalendarError>>;
}

/**
 * Map a boundary failure into this domain's own union at the point it is consumed, carrying the cause.
 *
 * Every seam below calls `safeProviderCall` DIRECTLY rather than through a shared helper. That is the
 * `boundary-residue` gate's requirement, not a style choice: it recognises a sanctioned boundary only when
 * the SDK call sits inside a `safeProviderCall(` — a wrapper one level up reads to it exactly like an
 * unwrapped call, which is the blindness it exists to prevent.
 */
function toCalendarError({ error }: { error: IngestError }): CalendarError {
  return CalendarErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * Map an `events.list` failure, distinguishing an INVALIDATED sync token from every other API failure.
 *
 * Google answers a sync token it will no longer honour with a 410 Gone, and that single status is the
 * difference between "this run should stop" and "this run should re-crawl by window and re-anchor".
 * Flattening it into {@link CalendarErrors.apiFailed} would leave the recovery undecidable at the one place
 * that can act on it, so the seam that knows the provider detail is where the distinction is made.
 *
 * @param error the typed boundary failure
 * @param calendarId the calendar the call was made against
 * @param usedSyncToken whether this call actually carried a token — a 410 on a window listing is not this
 * @returns the expiry variant for a 410 on a token call, else the generic API failure
 */
function eventsListError({
  error,
  calendarId,
  usedSyncToken,
}: {
  error: IngestError;
  calendarId: string;
  usedSyncToken: boolean;
}): CalendarError {
  return usedSyncToken && error.status === 410
    ? CalendarErrors.syncTokenExpired({ calendarId })
    : CalendarErrors.apiFailed({ cause: error, message: error.message });
}

/** Narrow one `calendarList` entry to the fields this door reports, dropping every null Google returns. */
function toSummary({ entry }: { entry: calendar_v3.Schema$CalendarListEntry }): CalendarSummary | undefined {
  if (typeof entry.id !== "string") {
    return undefined;
  }
  return {
    accessRole: accessRoleOf({ entry }),
    description: calendarDescriptionOf({ entry }),
    id: entry.id,
    primary: entry.primary === true,
    selected: entry.selected === true,
    summary: calendarNameOf({ entry }),
    timeZone: calendarZoneOf({ entry }),
  };
}

/**
 * What this grant may do with a listed calendar. The SDK declares `accessRole` optional, and an entry Google sent
 * without one states no role — a renderer shows it as unknown rather than guessing `reader`.
 */
function accessRoleOf({ entry }: { entry: calendar_v3.Schema$CalendarListEntry }): string | undefined {
  if (entry.accessRole == null) {
    return undefined;
  }
  return entry.accessRole;
}

/** A listed calendar's description, which a calendar its owner never described does not carry. */
function calendarDescriptionOf({ entry }: { entry: calendar_v3.Schema$CalendarListEntry }): string | undefined {
  if (entry.description == null) {
    return undefined;
  }
  return entry.description;
}

/** A listed calendar's title. The SDK declares `summary` optional, and one sent without it has no name to show. */
function calendarNameOf({ entry }: { entry: calendar_v3.Schema$CalendarListEntry }): string | undefined {
  if (entry.summary == null) {
    return undefined;
  }
  return entry.summary;
}

/** A listed calendar's own zone. The SDK declares `timeZone` optional, and one sent without it states none. */
function calendarZoneOf({ entry }: { entry: calendar_v3.Schema$CalendarListEntry }): string | undefined {
  if (entry.timeZone == null) {
    return undefined;
  }
  return entry.timeZone;
}

/**
 * The cursor to the calendar list's next page. Google leaves `nextPageToken` off the list's last page, and the
 * SDK's `null` is that same end: both read as no further page of calendars, never an empty cursor.
 */
function calendarListCursorOf({ data }: { data: calendar_v3.Schema$CalendarList }): string | undefined {
  if (data.nextPageToken == null) {
    return undefined;
  }
  return data.nextPageToken;
}

/**
 * The cursor to an event listing's next page. Google leaves `nextPageToken` off the listing's last page — the
 * one carrying `nextSyncToken` instead — and the SDK's `null` is that same end: no further page of events.
 */
function eventsCursorOf({ data }: { data: calendar_v3.Schema$Events }): string | undefined {
  if (data.nextPageToken == null) {
    return undefined;
  }
  return data.nextPageToken;
}

/**
 * The delta cursor. Google returns `nextSyncToken` only on the LAST page of an `events` listing, so every
 * earlier page arrives without one, and a page without one has nothing to resume a delta from.
 */
function deltaCursorOf({ data }: { data: calendar_v3.Schema$Events }): string | undefined {
  if (data.nextSyncToken == null) {
    return undefined;
  }
  return data.nextSyncToken;
}

/** The listed calendar's zone. The SDK declares an `events` page's `timeZone` optional; a page without one states none. */
function listingZoneOf({ data }: { data: calendar_v3.Schema$Events }): string | undefined {
  if (data.timeZone == null) {
    return undefined;
  }
  return data.timeZone;
}

/**
 * The account's zone setting. The SDK declares a `Setting`'s `value` optional, and a setting read back without
 * one leaves the account's zone unestablished — which every caller of the seam already says in so many words.
 */
function settingValueOf({ setting }: { setting: calendar_v3.Schema$Setting }): string | undefined {
  if (setting.value == null) {
    return undefined;
  }
  return setting.value;
}

/**
 * The entries one `calendarList` page carries. `items` is the list of calendars on the account's calendar
 * list. The SDK declares it optional, and the one thing its absence can say about a successful page is that no
 * calendar is on it; so an unset `items` (omitted, or `null`) reads as an empty page, as this seam always has.
 * No recording here shows Google omitting it — the reading rests on that declaration, not on an observation.
 */
function listedCalendars({
  data,
}: {
  data: calendar_v3.Schema$CalendarList;
}): readonly calendar_v3.Schema$CalendarListEntry[] {
  if (data.items == null) {
    return [];
  }
  return data.items;
}

/**
 * The events one `events.list` page carries. `items` is the list of events on the calendar inside the asked
 * window or since the sync token. The SDK declares it optional, and the one thing its absence can say about a
 * successful page is that no event is on it; so an unset `items` (omitted, or `null`) reads as an empty page,
 * as this seam always has. No recording here shows Google omitting it on an empty window.
 */
function listedEvents({ data }: { data: calendar_v3.Schema$Events }): readonly calendar_v3.Schema$Event[] {
  if (data.items == null) {
    return [];
  }
  return data.items;
}

/**
 * The `calendarList` seam — which calendars this grant can see at all.
 *
 * @param client the `@googleapis/calendar` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the calendar-list part of the seam
 */
function calendarListSeam({
  client,
  scopeId,
}: {
  client: calendar_v3.Calendar;
  scopeId: string;
}): Pick<CalendarApi, "listCalendars"> {
  return {
    listCalendars: async ({ pageToken }) =>
      safeProviderCall({
        execute: () => client.calendarList.list(pageToken !== undefined ? { pageToken } : {}),
        operation: "calendar.calendarList.list",
        provider: "calendar",
        retryMode: "transient",
        scopeId,
      })
        .map((response) => ({
          calendars: listedCalendars({ data: response.data })
            .map((entry) => toSummary({ entry }))
            .filter((entry): entry is CalendarSummary => entry !== undefined),
          nextPageToken: calendarListCursorOf({ data: response.data }),
        }))
        .mapErr((error) => toCalendarError({ error })),
  };
}

/**
 * The `events` seams — a listing and a single fetch. See {@link calendarListSeam} for why the seam is built
 * in pieces rather than as one function.
 *
 * @param client the `@googleapis/calendar` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the event part of the seam
 */
function eventSeams({
  client,
  scopeId,
}: {
  client: calendar_v3.Calendar;
  scopeId: string;
}): Pick<CalendarApi, "listEvents" | "getEvent"> {
  return {
    getEvent: async ({ calendarId, eventId }) =>
      safeProviderCall({
        execute: () => client.events.get({ calendarId, eventId }),
        operation: "calendar.events.get",
        provider: "calendar",
        retryMode: "transient",
        scopeId,
      })
        .map((response) => response.data)
        .mapErr((error) => toCalendarError({ error })),
    listEvents: async ({
      calendarId,
      timeMinIso,
      timeMaxIso,
      syncToken,
      pageToken,
      singleEvents,
      showDeleted,
      limit,
    }) =>
      safeProviderCall({
        execute: () =>
          client.events.list({
            calendarId,
            maxResults: limit,
            showDeleted,
            singleEvents,
            ...(syncToken !== undefined ? { syncToken } : {}),
            // `orderBy` is refused alongside a sync token, and start-time ordering is only defined at all
            // when instances have been expanded — so it is asked for in exactly the case both hold.
            ...(syncToken === undefined && singleEvents ? { orderBy: "startTime" } : {}),
            ...(syncToken === undefined && timeMinIso !== undefined ? { timeMin: timeMinIso } : {}),
            ...(syncToken === undefined && timeMaxIso !== undefined ? { timeMax: timeMaxIso } : {}),
            ...(pageToken !== undefined ? { pageToken } : {}),
          }),
        operation: "calendar.events.list",
        provider: "calendar",
        retryMode: "transient",
        scopeId,
      })
        .map((response): CalendarEventPage => ({
          events: listedEvents({ data: response.data }),
          nextPageToken: eventsCursorOf({ data: response.data }),
          nextSyncToken: deltaCursorOf({ data: response.data }),
          timeZone: listingZoneOf({ data: response.data }),
        }))
        .mapErr((error) => eventsListError({ calendarId, error, usedSyncToken: syncToken !== undefined })),
  };
}

/**
 * The `settings` seam — the account's own default time zone.
 *
 * @param client the `@googleapis/calendar` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the settings part of the seam
 */
function settingsSeam({
  client,
  scopeId,
}: {
  client: calendar_v3.Calendar;
  scopeId: string;
}): Pick<CalendarApi, "getTimeZone"> {
  return {
    getTimeZone: async () =>
      safeProviderCall({
        execute: () => client.settings.get({ setting: "timezone" }),
        operation: "calendar.settings.get",
        provider: "calendar",
        retryMode: "transient",
        scopeId,
      })
        .map((response) => settingValueOf({ setting: response.data }))
        .mapErr((error) => toCalendarError({ error })),
  };
}

/**
 * The production Calendar seam, bound to one resolved grant.
 *
 * @param client the `@googleapis/calendar` surface
 * @param account the account the grant bound to, hashed into the shared 429 rate scope
 * @returns every call the Calendar verbs make
 */
export function makeCalendarApi({ client, account }: { client: calendar_v3.Calendar; account: string }): CalendarApi {
  const scopeId = scopeIdForToken({ token: account });
  return {
    ...calendarListSeam({ client, scopeId }),
    ...eventSeams({ client, scopeId }),
    ...settingsSeam({ client, scopeId }),
  };
}

/**
 * Walk every page of a paged Calendar listing, stopping at a caller-supplied ceiling.
 *
 * Written as a shared walk rather than inline, because every caller has the same obligation: a listing that
 * stopped early must SAY it stopped early, and the only honest way to know is to still be holding a
 * `nextPageToken` when the ceiling is reached.
 *
 * @param fetchPage fetches one page given the cursor to resume from
 * @param maxItems the ceiling on items gathered across all pages
 * @param pageSize how many items to ask for per page
 * @returns every event gathered, the sync token when the walk reached the end, and whether it did
 */
export async function walkEventPages({
  fetchPage,
  maxItems,
  pageSize,
}: {
  fetchPage: (args: {
    pageToken: string | undefined;
    limit: number;
  }) => Promise<Result<CalendarEventPage, CalendarError>>;
  maxItems: number;
  pageSize: number;
}): Promise<
  Result<
    { events: readonly calendar_v3.Schema$Event[]; syncToken: string | undefined; complete: boolean },
    CalendarError
  >
> {
  const gathered: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const remaining = maxItems - gathered.length;
    if (remaining <= 0) {
      return ok({ complete: false, events: gathered, syncToken: undefined });
    }
    const page = await fetchPage({ limit: Math.min(pageSize, remaining), pageToken });
    if (page.isErr()) {
      return err(page.error);
    }
    gathered.push(...page.value.events);
    if (page.value.nextPageToken === undefined) {
      return ok({ complete: true, events: gathered, syncToken: page.value.nextSyncToken });
    }
    pageToken = page.value.nextPageToken;
  }
}
