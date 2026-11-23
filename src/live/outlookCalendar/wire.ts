/**
 * What each Microsoft Graph calendar endpoint the `outlook-calendar` door calls is allowed to answer — one strict
 * boundary per endpoint, from Microsoft's documented v1.0 `calendar` and `event` resources.
 *
 * The same two rules as the mail door's `../outlook/graphWire.ts`, for the same reasons:
 *
 * - **Every documented property is declared**, selected or not, and one the door never reads is `unread`, so a
 *   value nobody checked is never trusted.
 * - **A key Microsoft adds is refused by name.** The first read on a real diary either parses cleanly or names
 *   the field, which is one edit; a loose read would let a renamed field read as absent at exit 0.
 *
 * Nested objects the door READS (`start`, `attendees`, `organizer`, `location`, `recurrence`) are strict too.
 * Pure: no I/O.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

/** A declared key whose value the door never reads. */
const unread = z.unknown().optional();

/** A string Microsoft documents as present but which an event may leave null. */
const text = z.string().nullable().optional();

/** `emailAddress` — either half may be missing on a room or a contact-less guest. */
const emailAddressWire = z.strictObject({ address: text, name: text });

/** `dateTimeTimeZone` — a wall-clock `dateTime` with no offset, and the zone it is read in. */
const dateTimeTimeZoneWire = z.strictObject({ dateTime: z.string(), timeZone: text });

/** `responseStatus` — an attendee's answer, or the owner's own on the event. */
const responseStatusWire = z.strictObject({ response: text, time: text });

/** `attendee`. `proposedNewTime` is declared because Graph sends it on a counter-proposal. */
const attendeeWire = z.strictObject({
  emailAddress: emailAddressWire.nullable().optional(),
  proposedNewTime: unread,
  status: responseStatusWire.nullable().optional(),
  type: text,
});

/** `location`. Only the display name is read; the rest is declared so its arrival is not drift. */
const locationWire = z.strictObject({
  address: unread,
  coordinates: unread,
  displayName: text,
  locationEmailAddress: unread,
  locationType: unread,
  locationUri: unread,
  uniqueId: unread,
  uniqueIdType: unread,
});

/** `recurrencePattern`. */
const recurrencePatternWire = z.strictObject({
  dayOfMonth: z.number().optional(),
  daysOfWeek: z.array(z.string()).nullable().optional(),
  firstDayOfWeek: text,
  index: text,
  interval: z.number().optional(),
  month: z.number().optional(),
  type: text,
});

/** `recurrenceRange`. */
const recurrenceRangeWire = z.strictObject({
  endDate: text,
  numberOfOccurrences: z.number().optional(),
  recurrenceTimeZone: text,
  startDate: text,
  type: text,
});

/** `patternedRecurrence` — present on a series master, null on everything else. */
const recurrenceWire = z.strictObject({ pattern: recurrencePatternWire, range: recurrenceRangeWire });

/** `onlineMeetingInfo` — the join link is the one field read. */
const onlineMeetingWire = z.strictObject({
  conferenceId: unread,
  joinUrl: text,
  phones: unread,
  quickDial: unread,
  tollFreeNumbers: unread,
  tollNumber: unread,
});

/** `itemBody` — text when the door sends `outlook.body-content-type="text"`, else whatever was stored. */
const itemBodyWire = z.strictObject({ content: z.string(), contentType: z.enum(["text", "html"]) });

/**
 * `event`, every documented v1.0 property. `id` is the only required field: an event without one cannot be
 * read again, and an answer missing it is the shape change worth failing on.
 */
const eventWire = z.strictObject({
  "@odata.etag": unread,
  "@odata.type": unread,
  allowNewTimeProposals: unread,
  attendees: z.array(attendeeWire).optional(),
  body: itemBodyWire.nullable().optional(),
  bodyPreview: text,
  cancelledOccurrences: unread,
  categories: z.array(z.string()).optional(),
  changeKey: text,
  createdDateTime: text,
  end: dateTimeTimeZoneWire.nullable().optional(),
  exceptionOccurrences: unread,
  hasAttachments: z.boolean().optional(),
  hideAttendees: unread,
  iCalUId: text,
  id: z.string(),
  importance: text,
  isAllDay: z.boolean().optional(),
  isCancelled: z.boolean().optional(),
  isDraft: unread,
  isOnlineMeeting: z.boolean().optional(),
  isOrganizer: z.boolean().optional(),
  isReminderOn: unread,
  lastModifiedDateTime: text,
  location: locationWire.nullable().optional(),
  locations: unread,
  onlineMeeting: onlineMeetingWire.nullable().optional(),
  onlineMeetingProvider: unread,
  onlineMeetingUrl: text,
  organizer: z.strictObject({ emailAddress: emailAddressWire.nullable().optional() }).nullable().optional(),
  originalEndTimeZone: text,
  originalStart: unread,
  originalStartTimeZone: text,
  recurrence: recurrenceWire.nullable().optional(),
  reminderMinutesBeforeStart: unread,
  responseRequested: unread,
  responseStatus: responseStatusWire.nullable().optional(),
  sensitivity: text,
  seriesMasterId: text,
  showAs: text,
  start: dateTimeTimeZoneWire.nullable().optional(),
  subject: text,
  transactionId: unread,
  type: text,
  uid: unread,
  webLink: text,
});

/** One event as the door reads it. */
export type GraphEvent = z.output<typeof eventWire>;

/** `calendar`, every documented v1.0 property. */
const calendarWire = z.strictObject({
  "@odata.etag": unread,
  allowedOnlineMeetingProviders: unread,
  canEdit: z.boolean().optional(),
  canShare: unread,
  canViewPrivateItems: z.boolean().optional(),
  changeKey: unread,
  color: text,
  defaultOnlineMeetingProvider: unread,
  // `groupClassId`, `isShared` and `isSharedWithMe` are not on the v1.0 page but a personal account sends them
  // on an expanded calendar: measured on the first `outlook-calendar read`.
  groupClassId: unread,
  hexColor: unread,
  id: z.string(),
  isDefaultCalendar: z.boolean().optional(),
  isRemovable: unread,
  isShared: unread,
  isSharedWithMe: unread,
  isTallyingResponses: unread,
  name: text,
  owner: z.strictObject({ address: text, name: text }).nullable().optional(),
});

/** One calendar as the door reads it. */
export type GraphCalendar = z.output<typeof calendarWire>;

/** `GET /me/calendars` (page). */
export const CALENDAR_PAGE = defineBoundary({
  endpoint: "GET /me/calendars (page)",
  schema: z.strictObject({
    "@odata.context": unread,
    "@odata.nextLink": z.string().optional(),
    value: z.array(calendarWire),
  }),
});

/** `GET /me/calendarView`, `/me/calendars/{id}/calendarView` and `/me/calendars/{id}/events` (page). */
export const EVENT_PAGE = defineBoundary({
  endpoint: "GET /me/calendar events (page)",
  schema: z.strictObject({
    "@odata.context": unread,
    "@odata.nextLink": z.string().optional(),
    value: z.array(eventWire),
  }),
});

/**
 * One event read by its own id, with `$expand=calendar`: the only way a read by event id learns which calendar
 * holds the event. Graph ignores a nested `$select` there and sends the whole calendar, so it is checked as one.
 *
 * `Prefer: IdType="ImmutableId"` does not cover a calendar, so the expanded id is spelled differently from the
 * one `outlook-calendar calendars` prints — measured on a personal account, an `AQMk…` id here against an
 * `AAkA…` one there — yet both address the same calendar: `outlook-calendar list --calendar` with either
 * answered the same six events over the same window. So the id is usable as `--calendar`, never as a string
 * to compare against the listing. The `calendar@odata.*` annotations a single-entity read also carries stay
 * declared: the first real read was refused by name until they were.
 */
const eventReadWire = eventWire.extend({
  "@odata.context": unread,
  calendar: calendarWire.optional(),
  "calendar@odata.associationLink": unread,
  "calendar@odata.navigationLink": unread,
});

/** One event read by its own id, with the calendar that holds it. */
export type GraphEventRead = z.output<typeof eventReadWire>;

/** `GET /me/events/{id}` and `/me/calendars/{id}/events/{id}`. */
export const EVENT = defineBoundary({
  endpoint: "GET /me/events/{id}",
  schema: eventReadWire,
});
