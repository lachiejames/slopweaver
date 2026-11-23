/**
 * The PURE reading of a Graph `event` into the calendar's semantic shape — the same {@link ParsedCalendarEvent}
 * the Google door produces, so one renderer and one corpus text layout serve both diaries, plus the few facts
 * only Outlook carries.
 *
 * ## Time: an instant, or a bare date, and never one dressed as the other
 *
 * Every request sends `Prefer: outlook.timezone="UTC"` (`./api.ts`), so a timed event's `dateTime` is UTC wall
 * time with no offset and becomes an instant by reading it AS UTC. A point whose `timeZone` is anything else
 * is not turned into an instant — reading a Windows zone name needs a table this door does not carry — and the
 * event is reported with no usable time rather than placed at a guessed hour.
 *
 * `isAllDay` is the all-day discriminator, never a midnight. An all-day event is a bare date, and its date is
 * the event's OWN: Microsoft stores an all-day event at midnight in the zone it was authored in, so a UTC
 * reading of it can sit on the day before. The authored zone is not in the answer, so the date is the
 * `dateTime`'s calendar day as Graph wrote it, and the real-account proof in the pull request that introduced
 * this file is what says whether that is the owner's day.
 *
 * Pure: no I/O, no clock.
 */
import type { EventAttendee, EventTime, ParsedCalendarEvent } from "../calendar/parse.js";
import type { GraphEvent } from "./wire.js";

/** The facts Outlook reports that Google's shape has no field for. */
interface OutlookEventFacts {
  /** `singleInstance`, `occurrence`, `exception` or `seriesMaster`. */
  readonly type: string | undefined;
  /** `free`, `tentative`, `busy`, `oof`, `workingElsewhere` or `unknown`. */
  readonly showAs: string | undefined;
  /** Whether the bound account organised it. */
  readonly isOrganizer: boolean;
  /** The bound account's own answer: `organizer`, `accepted`, `declined`, `tentativelyAccepted`, `notResponded`, `none`. */
  readonly myResponse: string | undefined;
  /** The zone the start was authored in, as Microsoft names it (often a Windows zone name). */
  readonly authoredZone: string | undefined;
  /** The categories the owner filed it under. */
  readonly categories: readonly string[];
}

/** One Outlook event, read: the shared calendar shape plus {@link OutlookEventFacts}. */
export interface OutlookCalendarEvent extends ParsedCalendarEvent {
  readonly outlook: OutlookEventFacts;
}

/** Graph's `dateTime` as an RFC 3339 UTC instant: up to seven fractional digits, cut to milliseconds. */
const GRAPH_WALL_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?$/;

/**
 * Read one Graph `start`/`end` into the shared {@link EventTime}.
 *
 * @param point the `dateTimeTimeZone` Graph answered
 * @param allDay the event's `isAllDay`
 * @returns the timed or all-day reading, or undefined when the point is missing or is not a UTC wall time
 */
export function parseOutlookEventTime({
  point,
  allDay,
}: {
  point: GraphEvent["start"];
  allDay: boolean;
}): EventTime | undefined {
  if (point == null) {
    return undefined;
  }
  const match = GRAPH_WALL_TIME.exec(point.dateTime);
  if (match === null) {
    return undefined;
  }
  const [, wall, fraction] = match;
  if (allDay) {
    return { date: point.dateTime.slice(0, 10), kind: "all-day" };
  }
  if (point.timeZone !== "UTC" || wall === undefined) {
    return undefined;
  }
  const millis = fraction === undefined ? "" : `.${fraction.padEnd(3, "0").slice(0, 3)}`;
  return { dateTime: `${wall}${millis}Z`, kind: "timed", timeZone: undefined };
}

/** An event's categories: Graph omits the list when it selected none, which is an empty filing, not a gap. */
function categoryList({ categories }: { categories: readonly string[] | undefined }): readonly string[] {
  if (categories === undefined) {
    return [];
  }
  return categories;
}

/** A string Graph sent, with null and empty both read as absent. */
function present({ value }: { value: string | null | undefined }): string | undefined {
  if (value == null || value.length === 0) {
    return undefined;
  }
  return value;
}

/** One Graph attendee in the shared shape. A `resource` attendee is a room or equipment. */
function attendeeOf({ attendee }: { attendee: NonNullable<GraphEvent["attendees"]>[number] }): EventAttendee {
  return {
    displayName: present({ value: attendee.emailAddress?.name }),
    email: present({ value: attendee.emailAddress?.address }),
    optional: attendee.type === "optional",
    resource: attendee.type === "resource",
    responseStatus: present({ value: attendee.status?.response }),
    self: false,
  };
}

/**
 * A series master's rule, as one line a reader can follow. Graph's rule is structured rather than an RRULE,
 * so it is rendered field by field; `raw` in bronze keeps the structure itself.
 *
 * @returns the one-line rule, or no lines when the event is not a master
 */
function recurrenceLines({ recurrence }: { recurrence: GraphEvent["recurrence"] }): readonly string[] {
  if (recurrence == null) {
    return [];
  }
  const { pattern, range } = recurrence;
  const days =
    pattern.daysOfWeek == null || pattern.daysOfWeek.length === 0 ? "" : ` on ${pattern.daysOfWeek.join(",")}`;
  const every = pattern.interval === undefined ? "" : ` every ${String(pattern.interval)}`;
  const from = present({ value: range.startDate });
  const to = present({ value: range.endDate });
  const starting = from === undefined ? "" : ` from ${from}`;
  const ending = range.type === "endDate" && to !== undefined ? ` until ${to}` : "";
  const count =
    range.type === "numbered" && range.numberOfOccurrences !== undefined
      ? ` for ${String(range.numberOfOccurrences)} occurrences`
      : "";
  return [`${String(pattern.type)}${every}${days}${starting}${ending}${count}`];
}

/**
 * The join link: `onlineMeeting.joinUrl` when Graph built the meeting, else the older top-level
 * `onlineMeetingUrl`, which Microsoft still fills for some Skype and third-party meetings.
 */
function joinUrlOf({ event }: { event: GraphEvent }): string | undefined {
  const built = present({ value: event.onlineMeeting?.joinUrl });
  if (built !== undefined) {
    return built;
  }
  return present({ value: event.onlineMeetingUrl });
}

/** `showAs: free` is the one value that leaves the time open; everything else blocks it. */
function transparencyOf({ showAs }: { showAs: string | undefined }): string | undefined {
  if (showAs === undefined) {
    return undefined;
  }
  return showAs === "free" ? "transparent" : "opaque";
}

/**
 * Read one Graph event into {@link OutlookCalendarEvent}.
 *
 * @param event the boundary-checked wire event
 * @param calendarId the calendar it was read from, or `default` for a read over the default calendar
 * @returns the event, read
 */
export function parseOutlookEvent({
  event,
  calendarId,
}: {
  event: GraphEvent;
  calendarId: string;
}): OutlookCalendarEvent {
  const allDay = event.isAllDay === true;
  const showAs = present({ value: event.showAs });
  const organizerName = present({ value: event.organizer?.emailAddress?.name });
  const body = present({ value: event.body?.content.trim() });
  return {
    // An event Graph answered without the list has nobody on it: a solo block carries no `attendees` at all.
    attendees: event.attendees === undefined ? [] : event.attendees.map((attendee) => attendeeOf({ attendee })),
    calendarId,
    conferenceUrl: joinUrlOf({ event }),
    createdIso: present({ value: event.createdDateTime }),
    creatorEmail: undefined,
    description: body,
    end: parseOutlookEventTime({ allDay, point: event.end }),
    htmlLink: present({ value: event.webLink }),
    iCalUID: present({ value: event.iCalUId }),
    id: event.id,
    location: present({ value: event.location?.displayName }),
    organizerEmail: present({ value: event.organizer?.emailAddress?.address }),
    ...(organizerName !== undefined ? { organizerName } : {}),
    outlook: {
      authoredZone: present({ value: event.originalStartTimeZone }),
      categories: categoryList({ categories: event.categories }),
      isOrganizer: event.isOrganizer === true,
      myResponse: present({ value: event.responseStatus?.response }),
      showAs,
      type: present({ value: event.type }),
    },
    recurrence: recurrenceLines({ recurrence: event.recurrence }),
    recurringEventId: present({ value: event.seriesMasterId }),
    start: parseOutlookEventTime({ allDay, point: event.start }),
    status: event.isCancelled === true ? "cancelled" : "confirmed",
    summary: present({ value: event.subject }),
    transparency: transparencyOf({ showAs }),
    updatedIso: present({ value: event.lastModifiedDateTime }),
    visibility: present({ value: event.sensitivity }),
  };
}
