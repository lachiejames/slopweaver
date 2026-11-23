/**
 * The PURE projection of a Google Calendar event into the shape this repo reads, renders and stores.
 *
 * ## The one thing that is easy to get wrong, and why it has its own type
 *
 * A Google event's `start`/`end` is one of two genuinely different things, and they are not
 * interchangeable. A TIMED event carries `dateTime` — an RFC3339 instant, with a `timeZone` naming the zone
 * it was authored in. An ALL-DAY event carries `date` — a bare `YYYY-MM-DD` with **no instant at all**,
 * because "the 4th" means the 4th wherever the reader is. Google's own API says this by using two different
 * fields, and the commonest way to corrupt calendar data is to flatten them into one string and let a
 * consumer guess which it is holding.
 *
 * So {@link EventTime} is a discriminated union and every consumer here branches on it. That means:
 *
 * - an all-day event is never given a fabricated midnight UTC instant, which would be a real instant this repo
 *   invented and would silently shift the day for anyone east or west of UTC;
 * - a timed event keeps its authored zone alongside its instant, so a renderer can say `09:00
 *   Australia/Sydney` rather than a UTC time nobody scheduled;
 * - the ONE place a bare date has to become an ordering key ({@link eventSortKey}) does the conversion
 *   explicitly, in one function, and says in its own name that it is a sort key rather than an instant.
 *
 * ## What is deliberately not carried
 *
 * An attendee's `responseStatus` is carried; their `comment` is not, and neither is `attendees[].optional`
 * beyond a boolean. The full SDK object always survives in bronze's `raw`, so nothing is lost — this type
 * is the curated projection, not the capture.
 *
 * Pure: no I/O, no clock, no `Date.now()`.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import { parseIsoMs, parseYyyyMmDdUtcMs } from "../../lib/date.js";

/** A point on a calendar: either a real instant, or a whole day with no instant. */
export type EventTime =
  | {
      readonly kind: "timed";
      /** The RFC3339 instant, exactly as Google returned it. */
      readonly dateTime: string;
      /** The IANA zone the event was authored in, when Google reported one. */
      readonly timeZone: string | undefined;
    }
  | {
      readonly kind: "all-day";
      /** The bare `YYYY-MM-DD`. There is no instant here and none is invented. */
      readonly date: string;
    };

/** One person on an event, with what they said about it. */
export interface EventAttendee {
  readonly email: string | undefined;
  readonly displayName: string | undefined;
  /** `accepted`, `declined`, `tentative` or `needsAction`, as Google reports it. */
  readonly responseStatus: string | undefined;
  readonly optional: boolean;
  /** Whether this attendee IS the calendar the event was read from. */
  readonly self: boolean;
  /** Whether the attendee is a room or equipment rather than a person. */
  readonly resource: boolean;
}

/** The curated projection of one calendar event. */
export interface ParsedCalendarEvent {
  readonly id: string;
  /** The calendar this event was read from — an event id is only unique within one. */
  readonly calendarId: string;
  /** Google's stable identifier for the event ACROSS calendars, so the same meeting dedups between them. */
  readonly iCalUID: string | undefined;
  readonly summary: string | undefined;
  readonly description: string | undefined;
  readonly location: string | undefined;
  readonly start: EventTime | undefined;
  readonly end: EventTime | undefined;
  /** `confirmed`, `tentative` or `cancelled`. A cancelled event is kept, never silently dropped. */
  readonly status: string | undefined;
  readonly organizerEmail: string | undefined;
  /**
   * The organiser's display name, present only when Google sent a non-empty one. Optional rather than
   * `| undefined` so an event read before the corpus needed a name compares equal to one read after; the
   * corpus stores this as `author`, never the address ({@link ../../corpus/personName.personName}).
   */
  readonly organizerName?: string;
  readonly creatorEmail: string | undefined;
  readonly attendees: readonly EventAttendee[];
  /** The RRULE/EXDATE lines, present only on a recurring MASTER. */
  readonly recurrence: readonly string[];
  /** The master's id, present only on an instance that was individually changed. */
  readonly recurringEventId: string | undefined;
  /** The Meet/Zoom/Teams join URL, when the event carries conferencing. */
  readonly conferenceUrl: string | undefined;
  readonly htmlLink: string | undefined;
  /** When the event was last changed, RFC3339 — what a delta lane orders and watermarks by. */
  readonly updatedIso: string | undefined;
  readonly createdIso: string | undefined;
  /** `default`, `public`, `private` or `confidential`, as the owner marked it. */
  readonly visibility: string | undefined;
  /** `opaque` (busy) or `transparent` (free) — whether the event blocks time on the calendar. */
  readonly transparency: string | undefined;
}

/**
 * Read one `start`/`end` object into the union above.
 *
 * @internal — exported for the parser test; `parseCalendarEvent` is the production entry point.
 *
 * @param point the raw `start` or `end` Google returned
 * @returns the timed or all-day reading, or undefined when Google carried neither field
 */
export function parseEventTime({
  point,
}: {
  point: calendar_v3.Schema$EventDateTime | undefined;
}): EventTime | undefined {
  if (point == null) {
    return undefined;
  }
  if (typeof point.dateTime === "string" && point.dateTime.length > 0) {
    return { dateTime: point.dateTime, kind: "timed", timeZone: authoredZoneOf({ point }) };
  }
  if (typeof point.date === "string" && point.date.length > 0) {
    return { date: point.date, kind: "all-day" };
  }
  return undefined;
}

/**
 * The zone a timed point was authored in. Google requires `timeZone` only on a recurring event's points; on
 * any other the RFC3339 `dateTime` carries its own offset, so a point sent without one (omitted, or `null`)
 * names no zone and the instant stands alone.
 */
function authoredZoneOf({ point }: { point: calendar_v3.Schema$EventDateTime }): string | undefined {
  if (point.timeZone == null) {
    return undefined;
  }
  return point.timeZone;
}

/**
 * The epoch-millisecond key an event sorts and windows by.
 *
 * The ONE place a bare `YYYY-MM-DD` is turned into a number, and it is named a sort KEY rather than an
 * instant on purpose: an all-day date is read as UTC midnight because ordering needs a total order, not
 * because the event happens then. Nothing downstream is allowed to render this back as a time.
 *
 * @param time the parsed start or end
 * @returns the epoch milliseconds to order by, or undefined when the event carried no usable time
 */
export function eventSortKey({ time }: { time: EventTime | undefined }): number | undefined {
  if (time === undefined) {
    return undefined;
  }
  return time.kind === "timed" ? parseIsoMs({ tsIso: time.dateTime }) : parseYyyyMmDdUtcMs({ date: time.date });
}

/**
 * The ISO instant a corpus record timestamps itself with.
 *
 * @internal — exported for a caller that needs ONE instant for an event, such as a record timestamp.
 *
 * A record needs ONE `tsIso`, and for an all-day event there is honestly no instant — so this returns the
 * date extended to UTC midnight, and a caller that stores one is expected to record separately that the
 * event was all-day rather than pretend the two cases are the same. Returning `undefined` instead was
 * considered and rejected: a store that requires a timestamp would then have to drop the event entirely.
 *
 * @param time the parsed start
 * @returns the ISO-8601 instant, or undefined when the event carried no start at all
 */
export function eventTsIso({ time }: { time: EventTime | undefined }): string | undefined {
  if (time === undefined) {
    return undefined;
  }
  if (time.kind === "timed") {
    const ms = parseIsoMs({ tsIso: time.dateTime });
    return ms === undefined ? undefined : new Date(ms).toISOString();
  }
  const ms = parseYyyyMmDdUtcMs({ date: time.date });
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

/**
 * Read the attendee list, keeping rooms and resources rather than filtering them out silently.
 *
 * Google omits `attendees` from an event nobody was invited to — the recorded window listing under
 * `src/__tests__/integration/__recordings__/` carries the key on the events with guests and no such key on
 * the others. So an unset list (omitted, or `null`) is an event with no guests, and projects as an empty
 * list — the shape every consumer reads, and the one this projection has always given it.
 */
function parseAttendees({
  attendees,
}: {
  attendees: readonly calendar_v3.Schema$EventAttendee[] | null | undefined;
}): readonly EventAttendee[] {
  if (attendees === null || attendees === undefined) {
    return [];
  }
  return attendees.map((attendee) => ({
    displayName: attendeeDisplayName({ attendee }),
    email: attendeeEmail({ attendee }),
    optional: attendee.optional === true,
    resource: attendee.resource === true,
    responseStatus: attendeeResponse({ attendee }),
    self: attendee.self === true,
  }));
}

/** An attendee's name. Google gives it only "if available" — a guest added by bare address has none. */
function attendeeDisplayName({ attendee }: { attendee: calendar_v3.Schema$EventAttendee }): string | undefined {
  if (attendee.displayName == null) {
    return undefined;
  }
  return attendee.displayName;
}

/** An attendee's address. Google gives it only "if available", so an entry can arrive naming nobody by address. */
function attendeeEmail({ attendee }: { attendee: calendar_v3.Schema$EventAttendee }): string | undefined {
  if (attendee.email == null) {
    return undefined;
  }
  return attendee.email;
}

/**
 * What an attendee said. The SDK declares `responseStatus` optional, and an entry Google sent without one has
 * given no answer this read can show — a renderer says "no reply" rather than guessing `needsAction`.
 */
function attendeeResponse({ attendee }: { attendee: calendar_v3.Schema$EventAttendee }): string | undefined {
  if (attendee.responseStatus == null) {
    return undefined;
  }
  return attendee.responseStatus;
}

/**
 * The RRULE/EXDATE lines an event carries. Google omits `recurrence` "for single events or instances of
 * recurring events" (its own field documentation), so only a recurring MASTER has lines, and an unset field
 * (omitted, or `null`) is an event with none.
 */
function recurrenceLines({ event }: { event: calendar_v3.Schema$Event }): readonly string[] {
  if (event.recurrence === null || event.recurrence === undefined) {
    return [];
  }
  return event.recurrence;
}

/**
 * The join URL an event carries, preferring the structured conferencing block over the legacy field.
 *
 * @internal — exported for the parser test; `parseCalendarEvent` already calls it for every event.
 *
 * `conferenceData.entryPoints` is where Meet, and any Workspace add-on, puts a real join link;
 * `hangoutLink` is Google's older field and is still populated for Meet. Reading the structured one first
 * means a Zoom or Teams link added through an add-on is found, which `hangoutLink` alone would miss.
 *
 * @param event the raw event
 * @returns the join URL, or undefined when the event has no conferencing
 */
export function conferenceUrl({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  // No conferencing block, or one with no entry points, has no video entry to find: `?.` carries that through.
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && typeof entry.uri === "string",
  );
  if (video?.uri != null) {
    return video.uri;
  }
  // Google sets the read-only `hangoutLink` only on an event carrying a Meet conference: none, no join link.
  if (event.hangoutLink == null) {
    return undefined;
  }
  return event.hangoutLink;
}

/**
 * Project one raw Google event into {@link ParsedCalendarEvent}.
 *
 * @param event the raw SDK object
 * @param calendarId the calendar it was read from — Google does not carry this on the event itself
 * @returns the curated projection, or undefined when the event carried no id to address it by
 */
export function parseCalendarEvent({
  event,
  calendarId,
}: {
  event: calendar_v3.Schema$Event;
  calendarId: string;
}): ParsedCalendarEvent | undefined {
  if (typeof event.id !== "string" || event.id.length === 0) {
    return undefined;
  }
  return {
    attendees: parseAttendees({ attendees: event.attendees }),
    calendarId,
    conferenceUrl: conferenceUrl({ event }),
    createdIso: createdOf({ event }),
    creatorEmail: creatorAddress({ event }),
    description: descriptionOf({ event }),
    end: parseEventTime({ point: event.end }),
    htmlLink: webLinkOf({ event }),
    iCalUID: iCalUidOf({ event }),
    id: event.id,
    location: locationOf({ event }),
    organizerEmail: organiserAddress({ event }),
    ...organiserName({ event }),
    recurrence: recurrenceLines({ event }),
    recurringEventId: seriesIdOf({ event }),
    start: parseEventTime({ point: event.start }),
    status: statusOf({ event }),
    summary: titleOf({ event }),
    transparency: transparencyOf({ event }),
    updatedIso: updatedOf({ event }),
    visibility: visibilityOf({ event }),
  };
}

/*
 * One reader per optional event field below. Each SDK field is `string | null | undefined`, and Google sends
 * `null` and omits the key for the same thing; each reader says what that absence is for its own field. A
 * STUB — the cancelled or deleted event a delta listing returns — is the shared case: Google guarantees only its
 * id (and, for a cancelled occurrence, the series it belonged to), so every other field can be missing.
 */

/** When the event was created — read-only, and absent on a stub. */
function createdOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.created == null) {
    return undefined;
  }
  return event.created;
}

/** When the event last changed — read-only, and absent on a stub. */
function updatedOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.updated == null) {
    return undefined;
  }
  return event.updated;
}

/** Who created the event, by address; the reader sees no creator line when either absence below holds. */
function creatorAddress({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  const { creator } = event;
  // The whole `creator` block is read-only and Google leaves it off a cancelled stub, which carries only
  // its id and status — there is nobody on record to name.
  if (creator == null) {
    return undefined;
  }
  // The block is present but anonymous: the SDK types every field of it optional, and Google's Events
  // reference gives `creator.email` only "if available", so it can arrive carrying just a name, id or self.
  if (creator.email == null) {
    return undefined;
  }
  return creator.email;
}

/** Who organises the event, by address; the reader sees no organiser line when either absence below holds. */
function organiserAddress({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  const { organizer } = event;
  // Google leaves the `organizer` block off a cancelled stub, which carries only its id and status — there
  // is no organiser on record to name.
  if (organizer == null) {
    return undefined;
  }
  // The block is present but anonymous: the SDK types every field of it optional, and Google's Events
  // reference gives `organizer.email` only "if available", so it can arrive carrying just a name, id or self.
  if (organizer.email == null) {
    return undefined;
  }
  return organizer.email;
}

/** The organiser's display name as an optional field: absent on a stub, an anonymous block or a blank name. */
function organiserName({ event }: { event: calendar_v3.Schema$Event }): { organizerName?: string } {
  const name = event.organizer?.displayName;
  if (name == null || name.trim().length === 0) {
    return {};
  }
  return { organizerName: name.trim() };
}

/** The title. An event nobody titled has none, and nor does a stub or one this grant sees only as free/busy. */
function titleOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.summary == null) {
    return undefined;
  }
  return event.summary;
}

/** The description, which an event nobody described does not carry. */
function descriptionOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.description == null) {
    return undefined;
  }
  return event.description;
}

/** The free-text location, which an event held nowhere in particular does not carry. */
function locationOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.location == null) {
    return undefined;
  }
  return event.location;
}

/** The Calendar web link — read-only, and absent on a stub. */
function webLinkOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.htmlLink == null) {
    return undefined;
  }
  return event.htmlLink;
}

/** The cross-calendar iCalendar id — absent on a stub. */
function iCalUidOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.iCalUID == null) {
    return undefined;
  }
  return event.iCalUID;
}

/** The series an occurrence belongs to. Only an occurrence carries one: a single event or a master has none. */
function seriesIdOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.recurringEventId == null) {
    return undefined;
  }
  return event.recurringEventId;
}

/** `confirmed`, `tentative` or `cancelled`. The SDK declares it optional, and an event sent without one states none. */
function statusOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.status == null) {
    return undefined;
  }
  return event.status;
}

/** Whether the event blocks time. Google leaves the default `opaque` unsent, and a renderer says so. */
function transparencyOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.transparency == null) {
    return undefined;
  }
  return event.transparency;
}

/** Who may see the event. Google leaves the default `default` unsent, and a renderer says so. */
function visibilityOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  if (event.visibility == null) {
    return undefined;
  }
  return event.visibility;
}

/**
 * Render one {@link EventTime} for a human, without ever inventing an instant for an all-day date.
 *
 * @param time the parsed time
 * @returns the display string, or `(no time)` when the event carried none
 */
export function renderEventTime({ time }: { time: EventTime | undefined }): string {
  if (time === undefined) {
    return "(no time)";
  }
  if (time.kind === "all-day") {
    return `${time.date} (all day)`;
  }
  return time.timeZone === undefined ? time.dateTime : `${time.dateTime} [${time.timeZone}]`;
}
