/**
 * The human renderings of the `outlook-calendar` reads. A timed event prints as a UTC instant, an all-day one
 * as a bare date marked `(all day)`, through the same {@link renderEventTime} the Google door uses, so neither
 * door ever prints an all-day event as a time. Pure.
 */
import { renderEventTime } from "../calendar/parse.js";
import type { OutlookCalendarEvent } from "./parse.js";
import type { OutlookCalendarSummary, OutlookCalendarWindow } from "./read.js";

/** The one-word state an event is in, when it is not plainly on. */
function eventFlags({ event }: { event: OutlookCalendarEvent }): string {
  const flags = [
    ...(event.status === "cancelled" ? ["CANCELLED"] : []),
    ...(event.outlook.showAs === "free" ? ["free"] : []),
    ...(event.visibility === "private" ? ["private"] : []),
    ...(event.outlook.myResponse === "declined" ? ["you declined"] : []),
  ];
  return flags.length === 0 ? "" : ` [${flags.join(", ")}]`;
}

/** An event's title, or what its absence means. */
function titleOf({ event }: { event: OutlookCalendarEvent }): string {
  if (event.summary === undefined) {
    return "(busy, no detail)";
  }
  return event.summary;
}

/** A calendar's name, or what its absence means. */
function calendarName({ calendar }: { calendar: OutlookCalendarSummary }): string {
  if (calendar.name === undefined) {
    return "(unnamed)";
  }
  return calendar.name;
}

/** One attendee line: who, their reply, and whether they are optional or a room. */
function attendeeLine({ attendee }: { attendee: OutlookCalendarEvent["attendees"][number] }): string {
  let who = "(unnamed)";
  if (attendee.displayName !== undefined) {
    who = attendee.displayName;
  }
  let reply = "no reply";
  if (attendee.responseStatus !== undefined) {
    reply = attendee.responseStatus;
  }
  const marks = [...(attendee.optional ? [" (optional)"] : []), ...(attendee.resource ? [" (resource)"] : [])];
  return `  - ${who} — ${reply}${marks.join("")}`;
}

/** Who organised an event: their name, else their address, else nobody named. */
function organiserOf({ event }: { event: OutlookCalendarEvent }): string | undefined {
  if (event.organizerName !== undefined) {
    return event.organizerName;
  }
  return event.organizerEmail;
}

/**
 * The calendar list.
 *
 * @returns one line per calendar, default first
 */
export function renderOutlookCalendarsText({ calendars }: { calendars: readonly OutlookCalendarSummary[] }): string {
  if (calendars.length === 0) {
    return "no calendars on this account";
  }
  return calendars
    .map((calendar) => {
      const marks = [
        ...(calendar.isDefault ? ["default"] : []),
        ...(calendar.canEdit ? [] : ["read-only"]),
        ...(calendar.ownerName === undefined ? [] : [`owner ${calendar.ownerName}`]),
      ];
      return `${calendarName({ calendar })}${marks.length === 0 ? "" : ` (${marks.join(", ")})`}\n  id: ${calendar.id}`;
    })
    .join("\n");
}

/**
 * One window: a line per event, then the residue.
 *
 * @returns the listing
 */
export function renderOutlookCalendarWindowText({ window }: { window: OutlookCalendarWindow }): string {
  const header = `${String(window.events.length)} event(s) on ${window.calendar}, ${window.startIso} to ${window.endIso}`;
  const lines = window.events.map(
    (event) =>
      `- ${renderEventTime({ time: event.start })}  ${titleOf({ event })}${eventFlags({ event })}\n    id: ${event.id}`,
  );
  return [header, ...lines, "residue:", ...window.residue.map((line) => `  - ${line}`)].join("\n");
}

/**
 * One event in full.
 *
 * @returns the event's facts, then its attendees and body
 */
export function renderOutlookCalendarEventText({ event }: { event: OutlookCalendarEvent }): string {
  const attendees = event.attendees.map((attendee) => attendeeLine({ attendee }));
  return [
    `${titleOf({ event })}${eventFlags({ event })}`,
    `start: ${renderEventTime({ time: event.start })}`,
    `end: ${renderEventTime({ time: event.end })}`,
    ...factLines({ event }),
    `id: ${event.id}`,
    `calendar: ${event.calendarId}`,
    ...(attendees.length === 0 ? [] : [`attendees (${String(attendees.length)}):`, ...attendees]),
    ...(event.description === undefined ? [] : ["", event.description]),
  ].join("\n");
}

/** The event's optional facts, one line each, in the order a reader scans them; an absent fact prints nothing. */
function factLines({ event }: { event: OutlookCalendarEvent }): readonly string[] {
  const organiser = organiserOf({ event });
  return [
    ...(event.outlook.authoredZone === undefined ? [] : [`authored in: ${event.outlook.authoredZone}`]),
    ...(event.outlook.type === undefined ? [] : [`kind: ${event.outlook.type}`]),
    ...(event.recurrence.length === 0 ? [] : [`repeats: ${event.recurrence.join("; ")}`]),
    ...(event.recurringEventId === undefined ? [] : [`series: ${event.recurringEventId}`]),
    ...(event.location === undefined ? [] : [`location: ${event.location}`]),
    ...(organiser === undefined ? [] : [`organiser: ${organiser}${event.outlook.isOrganizer ? " (you)" : ""}`]),
    ...(event.outlook.myResponse === undefined ? [] : [`your reply: ${event.outlook.myResponse}`]),
    ...(event.conferenceUrl === undefined ? [] : [`join: ${event.conferenceUrl}`]),
    ...(event.htmlLink === undefined ? [] : [`open: ${event.htmlLink}`]),
  ];
}
