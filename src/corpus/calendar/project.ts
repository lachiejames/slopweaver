/**
 * The PURE projection of a crawled calendar event into a bronze {@link CorpusRecord}.
 *
 * ## What a calendar record is FOR, and what it therefore carries
 *
 * A diary answers "who committed to what, when, with whom". So the record's text is the three things a
 * reader of that question needs and nothing else: the title, the description the organiser wrote, and the
 * attendee list. It is not a transcript and never pretends to be — a meeting's WORDS arrive through the
 * mail door's meeting-notes lane, as a `transcript` record, and a calendar record links to the same event
 * rather than duplicating it.
 *
 * ## The recurring MASTER is the record, and the instances are not
 *
 * A recurring event is stored once, carrying its rule in `attrs.recurrence`. An instance the owner
 * individually moved or cancelled is a second record, carrying `attrs.recurringEventId`. Nothing here
 * expands a rule, because expansion is a lossy projection and bronze is the lossless capture — see
 * `./fetch.ts`'s header for why an expansion made at write time is a decision nobody can revisit.
 *
 * ## A cancelled event keeps its record
 *
 * `status: "cancelled"` is carried rather than filtered. "The review was called off" is a fact, and a
 * corpus that dropped it would assert the meeting took place. Google serves a cancelled instance as a STUB —
 * id, status, the series it belonged to, no title — so its text says `cancelled` in so many words: the store
 * refuses empty text, and 31 of the first window's 236 records were exactly these stubs.
 *
 * Pure: no I/O, no clock.
 */
import type { CalendarSummary } from "../../live/calendar/api.js";
import { eventTsIso, type ParsedCalendarEvent } from "../../live/calendar/parse.js";
import { personName } from "../personName.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { stampVisibility } from "../visibility.js";

/** How many attendees a record's TEXT names before it stops listing and starts counting. */
const NAMED_ATTENDEE_LIMIT = 40;

/**
 * The bronze `sourceId` for one event.
 *
 * `<calendarId>/<eventId>`, because an event id is only unique WITHIN a calendar — the same meeting
 * appears on every attendee's calendar under a different id, and two calendars can hold different events
 * that share one. Google's `iCalUID` is the cross-calendar identity and rides in `attrs`, so a later
 * feature can collapse them without this key having pretended they were the same record.
 *
 * @param calendarId the calendar the event was read from
 * @param eventId the event's own id within it
 * @returns the dedup key
 */
export function calendarSourceId({ calendarId, eventId }: { calendarId: string; eventId: string }): string {
  return `${calendarId}/${eventId}`;
}

/** One attendee as the projection carries it. */
type Attendee = ParsedCalendarEvent["attendees"][number];

/** How one attendee reads in a record's text: who, and what they said. */
function attendeeLine({ attendee }: { attendee: Attendee }): string {
  const who = attendeeWho({ attendee });
  const reply = attendeeReply({ attendee });
  return `- ${who} — ${reply}${attendee.optional ? " (optional)" : ""}${attendee.resource ? " (resource)" : ""}`;
}

/**
 * Who an attendee is, in a record's text. Google gives a name and an address each only "if available". The NAME
 * leads, because a diary is read by people asking who was in the room; the address stands in for a guest added
 * by bare address; an entry with neither is listed as unnamed, so the attendee count still adds up.
 */
function attendeeWho({ attendee }: { attendee: Attendee }): string {
  const { displayName } = attendee;
  if (displayName !== undefined) {
    return displayName;
  }
  const { email } = attendee;
  if (email !== undefined) {
    return email;
  }
  return "(unnamed)";
}

/** What an attendee said. An entry Google sent with no `responseStatus` has given no answer: "no reply". */
function attendeeReply({ attendee }: { attendee: Attendee }): string {
  if (attendee.responseStatus === undefined) {
    return "no reply";
  }
  return attendee.responseStatus;
}

/**
 * The record's link. Google's read-only `htmlLink` is missing from a stub — the cancelled or deleted event a
 * delta listing returns with little more than its id — and a record still needs somewhere to send a reader, so
 * a stub links to the event by its own id in Calendar's web editor, the address Calendar itself uses for one.
 */
function eventUrl({ event }: { event: ParsedCalendarEvent }): string {
  if (event.htmlLink === undefined) {
    return `https://calendar.google.com/calendar/u/0/r/eventedit/${event.id}`;
  }
  return event.htmlLink;
}

/**
 * The record's text: the title, the description, and who was in the room.
 *
 * The title LEADS, the way `github/project.ts` leads a pull request's text with its title: the store refuses
 * a record whose text is empty, and a solo block — "Home", "Focus", an all-day marker with no description,
 * no location and nobody invited — is exactly the event whose whole content is its title. MEASURED on the
 * first calendar window ever stored: 36 of 236 records refused as
 * `missing required field (sourceId/tsIso/container/text)`, every one of them a title-only event.
 *
 * Attendees are listed rather than counted because "who was in that meeting" is the commonest question a
 * diary answers, and a count answers none of it. The list is BOUNDED, though: an all-hands with four
 * hundred invitees would otherwise be four hundred lines of names in a record whose actual content is one
 * sentence, and the residue line says how many were not named.
 *
 * @param event the parsed event
 * @returns the record body
 */
export function calendarText({ event }: { event: ParsedCalendarEvent }): string {
  const named = event.attendees.slice(0, NAMED_ATTENDEE_LIMIT);
  const unnamed = event.attendees.length - named.length;
  return [
    ...(event.summary !== undefined ? [event.summary, ""] : []),
    ...(event.status === "cancelled" ? ["cancelled", ""] : []),
    ...(event.description !== undefined ? [event.description, ""] : []),
    ...(event.location !== undefined ? [`location: ${event.location}`, ""] : []),
    ...(event.attendees.length === 0 ? [] : [`attendees (${String(event.attendees.length)}):`]),
    ...named.map((attendee) => attendeeLine({ attendee })),
    ...(unnamed > 0 ? [`- and ${String(unnamed)} more, not named here`] : []),
  ]
    .join("\n")
    .trim();
}

/** When an event ends, in whichever of the two shapes it carries. */
function endsAt({ event }: { event: ParsedCalendarEvent }): Readonly<Record<string, CorpusAttributeValue>> {
  if (event.end === undefined) {
    return {};
  }
  return { endsAt: event.end.kind === "timed" ? event.end.dateTime : event.end.date };
}

/** The zone the event was authored in, when it is a timed event that carried one. */
function authoredZone({ event }: { event: ParsedCalendarEvent }): Readonly<Record<string, CorpusAttributeValue>> {
  if (event.start?.kind !== "timed" || event.start.timeZone === undefined) {
    return {};
  }
  return { timeZone: event.start.timeZone };
}

/** The facts about the CALENDAR an event sits on, rather than about the event itself. */
function calendarAttrs({ calendar }: { calendar: CalendarSummary }): Readonly<Record<string, CorpusAttributeValue>> {
  return {
    calendarId: calendar.id,
    // Whether this calendar is the account's OWN, which is what separates "the owner committed to this" from "the owner
    // can see this on a team calendar they subscribe to".
    primaryCalendar: calendar.primary,
    ...(calendar.summary !== undefined ? { calendarName: calendar.summary } : {}),
  };
}

/** The typed, queryable facts a later feature reads without re-fetching. */
function eventAttrs({
  event,
  calendar,
}: {
  event: ParsedCalendarEvent;
  calendar: CalendarSummary;
}): Readonly<Record<string, CorpusAttributeValue>> {
  return {
    allDay: event.start?.kind === "all-day",
    attendeeCount: event.attendees.length,
    recurring: event.recurrence.length > 0,
    ...calendarAttrs({ calendar }),
    ...endsAt({ event }),
    ...authoredZone({ event }),
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.transparency !== undefined ? { transparency: event.transparency } : {}),
    ...(event.visibility !== undefined ? { eventVisibility: event.visibility } : {}),
    ...(event.iCalUID !== undefined ? { iCalUid: event.iCalUID } : {}),
    ...(event.recurringEventId !== undefined ? { recurringEventId: event.recurringEventId } : {}),
    ...(event.recurrence.length > 0 ? { recurrence: event.recurrence } : {}),
    ...(event.conferenceUrl !== undefined ? { hasConferencing: true } : {}),
    ...(event.updatedIso !== undefined ? { updatedIso: event.updatedIso } : {}),
  };
}

/**
 * Project one parsed event into a bronze record.
 *
 * @param event the parsed event
 * @param calendar the calendar it was read from
 * @returns the record, or undefined when the event carries no usable time to place it at
 */
export function projectCalendarEvent({
  event,
  calendar,
}: {
  event: ParsedCalendarEvent;
  calendar: CalendarSummary;
}): CorpusRecord | undefined {
  const tsIso = eventTsIso({ time: event.start });
  if (tsIso === undefined) {
    return undefined;
  }
  const text = calendarText({ event });
  // The organiser's NAME, never their address: an address is a calendar's native id for a person, and an
  // attendee outside this workspace never agreed to be keyed on it (`docs/security/calendar-boundary.md`).
  const author = personName({ address: event.organizerEmail, displayName: event.organizerName });
  const record: CorpusRecord = {
    attrs: eventAttrs({ calendar, event }),
    container: calendar.id,
    kind: "event",
    // The full SDK object, redacted string-leaves by the bronze write path. Kept — unlike the mail door,
    // which drops it — because an event object is small and structured, so a later feature needing any
    // field it does not curate above never forces a re-crawl of the whole diary.
    raw: { ...event },
    refs: extractRefs({ text }),
    source: "calendar",
    sourceId: calendarSourceId({ calendarId: calendar.id, eventId: event.id }),
    text,
    tsIso,
    url: eventUrl({ event }),
    ...(author !== undefined ? { author } : {}),
    ...(event.summary !== undefined ? { title: event.summary } : {}),
  };
  // `private` is redundant with `isAlwaysPrivateSource`, and the redundancy is the point: the default is
  // PUBLIC, so a single projection path that forgot to stamp would put a diary into a non-owner's lane with
  // nothing to show it had happened. Two independent failures are needed rather than one omission.
  return stampVisibility({ record, visibility: "private" });
}

/**
 * What one projection pass produced, and what it refused.
 *
 * @internal — the declared shape `projectCalendarEvents` returns; callers destructure it.
 */
export interface CalendarProjection {
  readonly records: readonly CorpusRecord[];
  readonly warnings: readonly string[];
}

/**
 * Project every crawled event, counting what could not be placed rather than dropping it silently.
 *
 * @param events the parsed events, each with the calendar it came from
 * @returns the records, and a warning naming how many events carried no usable start
 */
export function projectCalendarEvents({
  events,
}: {
  events: readonly { readonly event: ParsedCalendarEvent; readonly calendar: CalendarSummary }[];
}): CalendarProjection {
  const records: CorpusRecord[] = [];
  let undated = 0;
  for (const { event, calendar } of events) {
    const record = projectCalendarEvent({ calendar, event });
    if (record === undefined) {
      undated += 1;
      continue;
    }
    records.push(record);
  }
  return {
    records,
    warnings:
      undated === 0
        ? []
        : [
            `${String(undated)} event(s) carried no usable start time and were not stored — bronze places a ` +
              "record on a timeline, and an event with nowhere to sit would be unfindable rather than wrong",
          ],
  };
}
