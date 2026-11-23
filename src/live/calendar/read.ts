/**
 * The three Calendar READ document builders — `calendar calendars`, `calendar list` and `calendar read` —
 * shaped exactly like every other named-object reader in `src/live`: a bounded read, a `readAtIso`, and a
 * coverage block that says what the read did NOT establish.
 *
 * ## Residue is the point, not decoration
 *
 * A calendar reads even more like "here is everything" than a mailbox does, because a week has a natural
 * edge and a listing looks complete. It is never everything, and each of these becomes a residue line:
 *
 * - a listing covers ONE window, and an event outside it is not absent, merely unread;
 * - a listing covers the calendars it was ASKED for, and an account subscribes to more than it looks at;
 * - a recurring event is expanded into instances here, so what is listed is what Google computed rather
 *   than what the owner authored — the rule itself is on the master;
 * - an event the grant can see only as free/busy carries no title at all, and a `private` one carries no
 *   detail, so a blank-looking hour may be a full one.
 *
 * Effectful only through the injected {@link CalendarApi} and the injected clock, so all three builders are
 * unit tested against plain fakes.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { ProviderReadDocument } from "../providerRead.js";
import { type CalendarApi, walkEventPages } from "./api.js";
import type { CalendarError } from "./errors.js";
import { CalendarErrors } from "./errors.js";
import { eventSortKey, type ParsedCalendarEvent, parseCalendarEvent } from "./parse.js";
import { eventResidue, listingResidue } from "./readResidue.js";

/**
 * The largest page `calendar list` will ask Google for in one call.
 *
 * @internal — exported so the page-walk test asserts the size against the constant rather than a literal.
 */
export const MAX_EVENT_PAGE = 250;

/** The largest number of events `calendar list` will gather across pages. */
export const MAX_LIST_LIMIT = 500;

/** The default number of events when the caller names none. */
export const DEFAULT_LIST_LIMIT = 50;

/** The calendar id that means "the account's own primary calendar", accepted by every Google endpoint. */
export const PRIMARY_CALENDAR = "primary";

/** The payload of a `calendar calendars` document. */
interface CalendarVocabulary {
  readonly account: string;
  readonly calendars: readonly {
    readonly id: string;
    readonly summary: string | undefined;
    readonly description: string | undefined;
    readonly timeZone: string | undefined;
    readonly accessRole: string | undefined;
    readonly primary: boolean;
    readonly selected: boolean;
  }[];
  /** The account's own default zone, which is what an all-day event is read against. */
  readonly accountTimeZone: string | undefined;
}

/** A calendar-vocabulary read: the shared document AND the typed payload. */
export interface CalendarVocabularyResult {
  readonly document: ProviderReadDocument;
  readonly vocabulary: CalendarVocabulary;
}

/** The payload of a `calendar list` document. */
export interface CalendarListing {
  readonly account: string;
  readonly calendarIds: readonly string[];
  readonly timeMinIso: string;
  readonly timeMaxIso: string;
  readonly events: readonly ParsedCalendarEvent[];
  /**
   * Whether `events` is every event in the window: each calendar read to its end, and every event Google returned
   * parsed. A caller deciding that a window holds nothing must read THIS, never count `events`.
   */
  readonly complete: boolean;
}

/** A listing read: the shared document AND the typed payload, so a caller never re-narrows `data`. */
export interface CalendarListingResult {
  readonly document: ProviderReadDocument;
  readonly listing: CalendarListing;
}

/** The payload of a `calendar read` document. */
interface CalendarEventPayload {
  readonly account: string;
  readonly event: ParsedCalendarEvent;
}

/** A single-event read: the shared document AND the typed payload. */
export interface CalendarEventResult {
  readonly document: ProviderReadDocument;
  readonly payload: CalendarEventPayload;
}

/**
 * List every calendar the grant can see, plus the account's own default time zone.
 *
 * @param api the injected Calendar seam
 * @param account the Google account the grant bound to
 * @param nowIso the read timestamp source
 * @returns the vocabulary document and its typed payload, or the typed reason the read failed
 */
export async function readCalendarVocabulary({
  api,
  account,
  nowIso,
}: {
  api: CalendarApi;
  account: string;
  nowIso: () => string;
}): Promise<Result<CalendarVocabularyResult, CalendarError>> {
  const walked = await walkCalendarPages({ api });
  if (walked.isErr()) {
    return err(walked.error);
  }
  // The account zone is a nicety rather than the answer, so a settings grant this install does not hold
  // degrades to "not established" instead of failing the whole read.
  const zone = await api.getTimeZone();
  const data: CalendarVocabulary = {
    account,
    accountTimeZone: zone.isOk() ? zone.value : undefined,
    calendars: walked.value.calendars,
  };
  return ok({
    document: {
      coverage: {
        detail: `${String(data.calendars.length)} calendar(s) this grant can see`,
        kind: "bounded",
        residue: vocabularyResidue({ truncated: walked.value.truncated, zoneEstablished: zone.isOk() }),
      },
      data,
      readAtIso: nowIso(),
      source: "calendar",
      target: { address: account, identity: account, kind: "calendar list" },
    },
    vocabulary: data,
  });
}

/**
 * Walk every page of the calendar list, stopping at {@link MAX_LIST_LIMIT}.
 *
 * @param api the injected Calendar seam
 * @returns every calendar gathered and whether the walk was cut short, or the read failure
 */
async function walkCalendarPages({
  api,
}: {
  api: CalendarApi;
}): Promise<Result<{ calendars: CalendarVocabulary["calendars"]; truncated: boolean }, CalendarError>> {
  const collected: CalendarVocabulary["calendars"][number][] = [];
  let pageToken: string | undefined;
  for (;;) {
    const page = await api.listCalendars({ pageToken });
    if (page.isErr()) {
      return err(page.error);
    }
    collected.push(...page.value.calendars);
    if (page.value.nextPageToken === undefined) {
      return ok({ calendars: collected, truncated: false });
    }
    // A Google account with more calendars than this has something unusual going on, and walking forever is
    // worse than saying so: the residue names the bound rather than the walk silently stopping.
    if (collected.length >= MAX_LIST_LIMIT) {
      return ok({ calendars: collected, truncated: true });
    }
    pageToken = page.value.nextPageToken;
  }
}

/**
 * The residue lines a calendar-list read always owes its reader.
 *
 * @param truncated whether the page walk stopped at its own ceiling rather than at the end
 * @param zoneEstablished whether the account's default time zone could be read
 * @returns the residue lines, in print order
 */
function vocabularyResidue({
  truncated,
  zoneEstablished,
}: {
  truncated: boolean;
  zoneEstablished: boolean;
}): readonly string[] {
  return [
    ...(truncated ? [`stopped at ${String(MAX_LIST_LIMIT)} calendars — more exist and were not read`] : []),
    ...(zoneEstablished
      ? []
      : [
          "the account's own default time zone was NOT established — the grant does not carry " +
            "calendar.settings.readonly, so an all-day event's day cannot be tied to a zone here",
        ]),
    "a calendar listed here is one this ACCOUNT subscribes to; `selected` says whether the owner has it " +
      "ticked in the interface, and an unticked calendar still holds events",
    "accessRole says what this grant can do with each calendar — a freeBusyReader sees times and no titles",
  ];
}

/**
 * List the events in one window across one or more calendars, ordered by start.
 *
 * Recurring events are expanded into instances, and cancelled ones are omitted, because this verb answers
 * "what is on" for a human. Both are this VERB's choices rather than the seam's — see `./api.ts`'s header
 * for why `singleEvents` is a caller's decision.
 *
 * @param api the injected Calendar seam
 * @param account the Google account the grant bound to
 * @param calendarIds the calendars to read, in the order the caller named them
 * @param timeMinIso the inclusive lower bound of the window
 * @param timeMaxIso the exclusive upper bound of the window
 * @param limit how many events to gather in total, capped at {@link MAX_LIST_LIMIT}
 * @param nowIso the read timestamp source
 * @returns the listing document and its typed payload, or the typed reason the read failed
 */
export async function readCalendarListing({
  api,
  account,
  calendarIds,
  timeMinIso,
  timeMaxIso,
  limit,
  nowIso,
}: {
  api: CalendarApi;
  account: string;
  calendarIds: readonly string[];
  timeMinIso: string;
  timeMaxIso: string;
  limit: number;
  nowIso: () => string;
}): Promise<Result<CalendarListingResult, CalendarError>> {
  const capped = Math.min(limit, MAX_LIST_LIMIT);
  const gathered = await gatherWindow({ api, calendarIds, capped, timeMaxIso, timeMinIso });
  if (gathered.isErr()) {
    return err(gathered.error);
  }
  const { events, unparsed } = gathered.value;
  const data: CalendarListing = {
    account,
    calendarIds,
    complete: gathered.value.complete && unparsed === 0,
    events,
    timeMaxIso,
    timeMinIso,
  };
  return ok({
    document: {
      coverage: {
        detail: `${String(events.length)} event(s) between ${timeMinIso} and ${timeMaxIso}, capped at ${String(capped)}`,
        kind: "bounded",
        residue: listingResidue({
          calendarIds,
          complete: gathered.value.complete,
          freeBusyOnly: events.filter((event) => event.summary === undefined).length,
          limit: capped,
          unparsed,
        }),
      },
      data,
      readAtIso: nowIso(),
      source: "calendar",
      target: { address: `${timeMinIso}..${timeMaxIso}`, identity: account, kind: "event window" },
    },
    listing: data,
  });
}

/**
 * Read one window across every named calendar and order the result by start.
 *
 * Sorted HERE rather than trusted from the API: Google orders within ONE calendar, and a listing across
 * several is otherwise a concatenation that reads as though it were chronological.
 *
 * @param api the injected Calendar seam
 * @param calendarIds the calendars to read, in the order the caller named them
 * @param timeMinIso the inclusive lower bound
 * @param timeMaxIso the exclusive upper bound
 * @param capped the total-event ceiling, already clamped
 * @returns the ordered events, whether every calendar was read to its end, and how many events Google returned
 *   that would not parse, or the read failure
 */
async function gatherWindow({
  api,
  calendarIds,
  timeMinIso,
  timeMaxIso,
  capped,
}: {
  api: CalendarApi;
  calendarIds: readonly string[];
  timeMinIso: string;
  timeMaxIso: string;
  capped: number;
}): Promise<Result<{ events: readonly ParsedCalendarEvent[]; complete: boolean; unparsed: number }, CalendarError>> {
  const events: ParsedCalendarEvent[] = [];
  let complete = true;
  let unparsed = 0;
  for (const calendarId of calendarIds) {
    const walked = await walkEventPages({
      fetchPage: ({ pageToken, limit: pageLimit }) =>
        api.listEvents({
          calendarId,
          limit: pageLimit,
          pageToken,
          showDeleted: false,
          singleEvents: true,
          timeMaxIso,
          timeMinIso,
        }),
      maxItems: capped,
      pageSize: MAX_EVENT_PAGE,
    });
    if (walked.isErr()) {
      return err(walked.error);
    }
    complete = complete && walked.value.complete;
    for (const raw of walked.value.events) {
      const parsed = parseCalendarEvent({ calendarId, event: raw });
      if (parsed === undefined) {
        unparsed += 1;
      } else {
        events.push(parsed);
      }
    }
  }
  return ok({
    complete,
    unparsed,
    events: events.toSorted((a, b) => listingOrder({ left: a, right: b })),
  });
}

/**
 * How two events order in a listing. An event whose start Google left unset, or sent as text no instant parses
 * from, has no place on the timeline, so it LEADS the listing — ahead of every dated event, a pre-1970 one
 * included — where a reader meets it first rather than finding it lost among the dated ones. Two such events
 * compare equal, and `toSorted` is stable, so they keep Google's own order between them.
 */
function listingOrder({ left, right }: { left: ParsedCalendarEvent; right: ParsedCalendarEvent }): number {
  const leftKey = eventSortKey({ time: left.start });
  const rightKey = eventSortKey({ time: right.start });
  if (leftKey === undefined || rightKey === undefined) {
    return Number(rightKey === undefined) - Number(leftKey === undefined);
  }
  return leftKey - rightKey;
}

/**
 * Read one event in full.
 *
 * @param api the injected Calendar seam
 * @param account the Google account the grant bound to
 * @param calendarId the calendar holding the event
 * @param eventId the identifier Google addresses it by WITHIN that calendar, not across the account
 * @param nowIso the read timestamp source
 * @returns the read document and its typed payload, or the typed reason the read failed
 */
export async function readCalendarEvent({
  api,
  account,
  calendarId,
  eventId,
  nowIso,
}: {
  api: CalendarApi;
  account: string;
  calendarId: string;
  eventId: string;
  nowIso: () => string;
}): Promise<Result<CalendarEventResult, CalendarError>> {
  const fetched = await api.getEvent({ calendarId, eventId });
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  const parsed = parseCalendarEvent({ calendarId, event: fetched.value });
  if (parsed === undefined) {
    return err(
      CalendarErrors.invalidAddress({
        message: `Google returned an event with no id for ${eventId} on ${calendarId} — nothing to report`,
      }),
    );
  }
  const data: CalendarEventPayload = { account, event: parsed };
  return ok({
    document: {
      coverage: {
        detail: "one event, read in full",
        kind: "bounded",
        residue: eventResidue({ event: parsed }),
      },
      data,
      readAtIso: nowIso(),
      source: "calendar",
      target: { address: `${calendarId}/${eventId}`, identity: account, kind: "event" },
    },
    payload: data,
  });
}
