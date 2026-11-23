/**
 * The PURE projection of a crawled Outlook event into a bronze {@link CorpusRecord}.
 *
 * Its text and its key are the Google lane's own (`../calendar/project.ts`'s {@link calendarText} and
 * {@link calendarSourceId}), because both diaries answer the same question, "who committed to what, when, with
 * whom", and one text layout lets a reader treat them alike. What differs is the calendar a record sits on,
 * the link, and the facts only Outlook reports: how the owner answered, how the time shows, which categories
 * they filed it under.
 *
 * As there, the recurring MASTER is the record and its occurrences are not, a cancelled event keeps its
 * record, and an event with no usable start is counted rather than dropped in silence.
 *
 * Pure: no I/O, no clock.
 */
import { eventTsIso } from "../../live/calendar/parse.js";
import { type OutlookCalendarEvent, parseOutlookEvent } from "../../live/outlookCalendar/parse.js";
import type { OutlookCalendarSummary } from "../../live/outlookCalendar/read.js";
import type { GraphEvent } from "../../live/outlookCalendar/wire.js";
import { calendarSourceId, calendarText } from "../calendar/project.js";
import { personName } from "../personName.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { stampVisibility } from "../visibility.js";

/** The facts about the calendar an event sits on. */
function calendarAttrs({
  calendar,
}: {
  calendar: OutlookCalendarSummary;
}): Readonly<Record<string, CorpusAttributeValue>> {
  return {
    calendarId: calendar.id,
    // The account's default calendar is its own diary; any other may be a shared one somebody else owns.
    primaryCalendar: calendar.isDefault,
    ...(calendar.name !== undefined ? { calendarName: calendar.name } : {}),
  };
}

/** When an event ends, in whichever of the two shapes it carries. */
function endsAt({ event }: { event: OutlookCalendarEvent }): Readonly<Record<string, CorpusAttributeValue>> {
  if (event.end === undefined) {
    return {};
  }
  return { endsAt: event.end.kind === "timed" ? event.end.dateTime : event.end.date };
}

/** The facts only Outlook reports. */
function outlookAttrs({ event }: { event: OutlookCalendarEvent }): Readonly<Record<string, CorpusAttributeValue>> {
  const facts = event.outlook;
  return {
    isOrganizer: facts.isOrganizer,
    ...(facts.type !== undefined ? { eventType: facts.type } : {}),
    ...(facts.showAs !== undefined ? { showAs: facts.showAs } : {}),
    ...(facts.myResponse !== undefined ? { myResponse: facts.myResponse } : {}),
    ...(facts.authoredZone !== undefined ? { timeZone: facts.authoredZone } : {}),
    ...(facts.categories.length > 0 ? { categories: facts.categories } : {}),
  };
}

/** The typed, queryable facts a later feature reads without re-fetching. */
function eventAttrs({
  event,
  calendar,
}: {
  event: OutlookCalendarEvent;
  calendar: OutlookCalendarSummary;
}): Readonly<Record<string, CorpusAttributeValue>> {
  return {
    allDay: event.start?.kind === "all-day",
    attendeeCount: event.attendees.length,
    recurring: event.recurrence.length > 0,
    ...calendarAttrs({ calendar }),
    ...endsAt({ event }),
    ...outlookAttrs({ event }),
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
 * The record's link: Outlook's own `webLink`, or the calendar's item view by id when Graph sent none.
 *
 * @returns the URL a reader opens the event at
 */
function eventUrl({ event }: { event: OutlookCalendarEvent }): string {
  if (event.htmlLink !== undefined) {
    return event.htmlLink;
  }
  return `https://outlook.live.com/calendar/item/${encodeURIComponent(event.id)}`;
}

/**
 * Project one wire event, read from one calendar, into a bronze record.
 *
 * @param event the boundary-checked wire event, kept whole in `raw`
 * @param calendar the calendar it was read from
 * @returns the record, or undefined when the event carries no usable start to place it at
 */
export function projectOutlookCalendarEvent({
  event,
  calendar,
}: {
  event: GraphEvent;
  calendar: OutlookCalendarSummary;
}): CorpusRecord | undefined {
  const parsed = parseOutlookEvent({ calendarId: calendar.id, event });
  const tsIso = eventTsIso({ time: parsed.start });
  if (tsIso === undefined) {
    return undefined;
  }
  const text = calendarText({ event: parsed });
  // The organiser's NAME, never their address (`docs/security/calendar-boundary.md`).
  const author = personName({ address: parsed.organizerEmail, displayName: parsed.organizerName });
  const record: CorpusRecord = {
    attrs: eventAttrs({ calendar, event: parsed }),
    container: calendar.id,
    kind: "event",
    // The wire event whole, redacted string-leaves by the bronze write path, so a later feature needing a
    // field not curated above never forces a re-crawl of the whole diary.
    raw: { ...event },
    refs: extractRefs({ text }),
    source: "outlook-calendar",
    sourceId: calendarSourceId({ calendarId: calendar.id, eventId: parsed.id }),
    text,
    tsIso,
    url: eventUrl({ event: parsed }),
    ...(author !== undefined ? { author } : {}),
    ...(parsed.summary !== undefined ? { title: parsed.summary } : {}),
  };
  // Redundant with the manifest's `alwaysPrivate`, deliberately: two independent failures are needed for a
  // diary to reach a non-owner's lane, rather than one omission.
  return stampVisibility({ record, visibility: "private" });
}

/** What one projection pass produced, and what it refused. */
export interface OutlookCalendarProjection {
  readonly records: readonly CorpusRecord[];
  readonly warnings: readonly string[];
}

/**
 * Project every crawled event, counting what could not be placed rather than dropping it silently.
 *
 * @param events the wire events, each with the calendar it came from
 * @returns the records, and a warning naming how many events carried no usable start
 */
export function projectOutlookCalendarEvents({
  events,
}: {
  events: readonly { readonly event: GraphEvent; readonly calendar: OutlookCalendarSummary }[];
}): OutlookCalendarProjection {
  const records: CorpusRecord[] = [];
  let undated = 0;
  for (const { event, calendar } of events) {
    const record = projectOutlookCalendarEvent({ calendar, event });
    if (record === undefined) {
      undated += 1;
      continue;
    }
    records.push(record);
  }
  const warnings =
    undated === 0
      ? []
      : [
          `${String(undated)} Outlook event(s) carried no usable start time and were not stored — a timed event ` +
            "not answered in UTC, or one with no start, has nowhere to sit on a timeline",
        ];
  return { records, warnings };
}
