/**
 * Human renderings of the four Calendar read documents.
 *
 * Every one leads with freshness and coverage and only then shows the payload, for the reason
 * `providerRead.ts` gives: a reader who scrolls straight to the events must still have been told what the
 * read did not cover. Pure — string in, string out, no clock and no I/O.
 */
import type { CalendarFreeResult } from "./free.js";
import { type EventAttendee, renderEventTime } from "./parse.js";
import type { CalendarEventResult, CalendarListingResult, CalendarVocabularyResult } from "./read.js";
import { renderInZone } from "./wallClockText.js";

/** The header every rendering shares: what was read, when, and what the read did not establish. */
function header({
  kind,
  identity,
  readAtIso,
  coverageDetail,
  residue,
}: {
  kind: string;
  identity: string;
  readAtIso: string;
  coverageDetail: string;
  residue: readonly string[];
}): readonly string[] {
  return [
    `calendar ${kind}: ${identity}`,
    `read at: ${readAtIso}`,
    `coverage: bounded — ${coverageDetail}`,
    "residue:",
    ...(residue.length === 0 ? ["  none"] : residue.map((line) => `  - ${line}`)),
    "",
  ];
}

/**
 * The account's zone line. The vocabulary read leaves `accountTimeZone` unset when the account's settings
 * could not be read, so the zone was never established — which is what the line says.
 */
function accountZoneLine({ zone }: { zone: string | undefined }): string {
  if (zone === undefined) {
    return "account time zone: (not established)";
  }
  return `account time zone: ${zone}`;
}

/** A calendar's zone field. Google marks a calendar list entry's `timeZone` optional; one it leaves out has none. */
function calendarZoneField({ zone }: { zone: string | undefined }): string {
  if (zone === undefined) {
    return "zone: (none)";
  }
  return `zone: ${zone}`;
}

/** A calendar's name. Google marks a calendar list entry's `summary` optional; one it leaves out has no name. */
function calendarName({ summary }: { summary: string | undefined }): string {
  if (summary === undefined) {
    return "(no name)";
  }
  return summary;
}

/**
 * A calendar's access field. Google marks a calendar list entry's `accessRole` optional, and one it leaves out
 * says nothing about what this grant may do — so the role is shown as unknown rather than guessed.
 */
function accessField({ role }: { role: string | undefined }): string {
  if (role === undefined) {
    return "access: (unknown)";
  }
  return `access: ${role}`;
}

/**
 * Render `calendar calendars` for a human — one line per calendar, with the id the API takes.
 *
 * @param result the vocabulary read
 * @returns the text rendering
 */
export function renderCalendarVocabularyText({ result }: { result: CalendarVocabularyResult }): string {
  const { document, vocabulary } = result;
  return [
    ...header({
      coverageDetail: document.coverage.detail,
      identity: vocabulary.account,
      kind: "calendars",
      readAtIso: document.readAtIso,
      residue: document.coverage.residue,
    }),
    accountZoneLine({ zone: vocabulary.accountTimeZone }),
    "",
    ...vocabulary.calendars.map((entry) =>
      [
        `${entry.primary ? "*" : " "} ${calendarName({ summary: entry.summary })}`,
        `    id: ${entry.id}`,
        `    ${accessField({ role: entry.accessRole })} · ${calendarZoneField({ zone: entry.timeZone })} · ${
          entry.selected ? "ticked" : "unticked"
        }`,
      ].join("\n"),
    ),
  ].join("\n");
}

/** One listing line: when, what, and who — the three things a triage decision needs. */
function listingLine({
  start,
  end,
  summary,
  attendeeCount,
  id,
  calendarId,
}: {
  start: string;
  end: string;
  summary: string;
  attendeeCount: number;
  id: string;
  calendarId: string;
}): string {
  return [
    `${start} → ${end}`,
    `    ${summary}`,
    `    ${String(attendeeCount)} attendee(s) · ${calendarId} · ${id}`,
  ].join("\n");
}

/**
 * Render `calendar list` for a human — the window, then one block per event.
 *
 * @param result the listing read
 * @returns the text rendering
 */
export function renderCalendarListingText({ result }: { result: CalendarListingResult }): string {
  const { document, listing } = result;
  return [
    ...header({
      coverageDetail: document.coverage.detail,
      identity: listing.account,
      kind: "events",
      readAtIso: document.readAtIso,
      residue: document.coverage.residue,
    }),
    ...(listing.events.length === 0
      ? ["(no events in this window on the calendars read)"]
      : listing.events.map((event) =>
          listingLine({
            attendeeCount: event.attendees.length,
            calendarId: event.calendarId,
            end: renderEventTime({ time: event.end }),
            id: event.id,
            start: renderEventTime({ time: event.start }),
            summary: eventTitle({ summary: event.summary }),
          }),
        )),
  ].join("\n");
}

/**
 * An event's title as a human reads it. Google sends no `summary` for an event nobody titled, nor for one this
 * grant may see only as free/busy or as someone else's private event — which is what the stand-in says.
 */
function eventTitle({ summary }: { summary: string | undefined }): string {
  if (summary === undefined) {
    return "(no title — free/busy or private)";
  }
  return summary;
}

/** The status field. Google marks an event's `status` optional, and one it leaves out is shown as unknown. */
function statusField({ status }: { status: string | undefined }): string {
  if (status === undefined) {
    return "status: (unknown)";
  }
  return `status: ${status}`;
}

/** The shows-as field. Google documents `opaque` as `transparency`'s default, which is what an unset one means. */
function showsAsField({ transparency }: { transparency: string | undefined }): string {
  if (transparency === undefined) {
    return "shows as: opaque";
  }
  return `shows as: ${transparency}`;
}

/** The visibility field. Google documents `default` as `visibility`'s default, which is what an unset one means. */
function visibilityField({ visibility }: { visibility: string | undefined }): string {
  if (visibility === undefined) {
    return "visibility: default";
  }
  return `visibility: ${visibility}`;
}

/**
 * The organiser line. Google gives the organiser's address only "if available", and a cancelled event may
 * carry nothing but its id, so an event read without one names no organiser.
 */
function organiserLine({ email }: { email: string | undefined }): string {
  if (email === undefined) {
    return "organiser: (unknown)";
  }
  return `organiser: ${email}`;
}

/**
 * Who an attendee is, for a human. Google gives an attendee's address and name each only "if available": the
 * address leads, the name stands in for an entry with no address, and an entry with neither is unnamed.
 */
function attendeeName({ attendee }: { attendee: EventAttendee }): string {
  const { email } = attendee;
  if (email !== undefined) {
    return email;
  }
  const { displayName } = attendee;
  if (displayName !== undefined) {
    return displayName;
  }
  return "(unnamed)";
}

/**
 * What an attendee said, for a human. An entry Google sent with no `responseStatus` has given no answer this
 * read can show, which is what "no reply" says — never a guessed `needsAction`.
 */
function attendeeReply({ attendee }: { attendee: EventAttendee }): string {
  if (attendee.responseStatus === undefined) {
    return "no reply";
  }
  return attendee.responseStatus;
}

/**
 * Render `calendar read` for a human — the whole event, attendees and all.
 *
 * @param result the single-event read
 * @returns the text rendering
 */
export function renderCalendarEventText({ result }: { result: CalendarEventResult }): string {
  const { document, payload } = result;
  const event = payload.event;
  return [
    ...header({
      coverageDetail: document.coverage.detail,
      identity: payload.account,
      kind: "event",
      readAtIso: document.readAtIso,
      residue: document.coverage.residue,
    }),
    `title: ${eventTitle({ summary: event.summary })}`,
    `when: ${renderEventTime({ time: event.start })} → ${renderEventTime({ time: event.end })}`,
    [
      statusField({ status: event.status }),
      showsAsField({ transparency: event.transparency }),
      visibilityField({ visibility: event.visibility }),
    ].join(" · "),
    organiserLine({ email: event.organizerEmail }),
    ...(event.location !== undefined ? [`location: ${event.location}`] : []),
    ...(event.conferenceUrl !== undefined ? [`join: ${event.conferenceUrl}`] : []),
    ...(event.recurrence.length > 0 ? ["recurrence:", ...event.recurrence.map((rule) => `  ${rule}`)] : []),
    ...(event.htmlLink !== undefined ? [`link: ${event.htmlLink}`] : []),
    "",
    `attendees (${String(event.attendees.length)}):`,
    ...event.attendees.map(
      (attendee) =>
        `  - ${attendeeName({ attendee })} · ${attendeeReply({ attendee })}` +
        `${attendee.optional ? " · optional" : ""}${attendee.resource ? " · resource" : ""}`,
    ),
    "",
    ...(event.description !== undefined ? ["description:", event.description] : ["(no description)"]),
  ].join("\n");
}

/**
 * Render `calendar free` for a human — what each calendar said, then the open stretches in the zone.
 *
 * A refused calendar is rendered in its own line AND empties the slot list: a reader who scrolled past the
 * residue still cannot mistake "unknown" for "free".
 *
 * @param result the free read
 * @returns the text rendering
 */
export function renderCalendarFreeText({ result }: { result: CalendarFreeResult }): string {
  const { document, free } = result;
  // The end is shown as a bare `HH:MM` only while it falls on the SAME local day as the start. A slot that
  // closes at the day's boundary ends at 00:00 the next morning, and "09:00 → 00:00" read as a nine-hour
  // slot running backwards; the whole instant is shown instead whenever the date moves.
  const slotLine = ({ startMs, endMs }: { startMs: number; endMs: number }): string => {
    const start = renderInZone({ atMs: startMs, zone: free.zone });
    const end = renderInZone({ atMs: endMs, zone: free.zone });
    const sameDay = start.slice(0, 10) === end.slice(0, 10);
    return `${start} → ${sameDay ? end.slice(-5) : end} (${String(Math.floor((endMs - startMs) / 60_000))} min)`;
  };
  return [
    ...header({
      coverageDetail: document.coverage.detail,
      identity: free.account,
      kind: "free",
      readAtIso: document.readAtIso,
      residue: document.coverage.residue,
    }),
    `zone: ${free.zone} · meeting length: ${String(free.minutes)} min`,
    "",
    "calendars:",
    ...free.calendars.map((entry) =>
      entry.error === undefined
        ? `  ${entry.calendarId}: ${String(entry.busy.length)} busy interval(s)`
        : `  ${entry.calendarId}: REFUSED (${entry.error}) — availability unknown`,
    ),
    "",
    ...slotLines({ free, slotLine }),
  ].join("\n");
}

/** The slot section of a free rendering: refused, empty, or the open stretches. */
function slotLines({
  free,
  slotLine,
}: {
  free: CalendarFreeResult["free"];
  slotLine: (slot: { startMs: number; endMs: number }) => string;
}): readonly string[] {
  if (free.slots === undefined) {
    return ["(no common slots can be stated: a calendar above refused)"];
  }
  if (free.slots.length === 0) {
    return [`(no open stretch of ${String(free.minutes)} min or more in this window)`];
  }
  return ["open:", ...free.slots.map((slot) => `  ${slotLine(slot)}`)];
}
