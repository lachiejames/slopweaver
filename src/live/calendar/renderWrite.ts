/**
 * Human renderings of a calendar write: the preview a hold puts in front of a person, and the outcome an
 * applied write reports. Pure — string in, string out.
 *
 * The preview is printed BEFORE the door decides and on every path, exactly as `gmail send`'s is: a caller
 * about to be refused needs to see what would have been sent even more than one about to succeed.
 */
import type { calendar_v3 } from "@googleapis/calendar";

import { parseEventTime, renderEventTime } from "./parse.js";
import type { CalendarWriteOutcome } from "./write.js";
import type { CalendarWritePlan } from "./writePlan.js";

/** One `label: value` line, skipped when the value is absent. */
function line({ label, value }: { label: string; value: string | undefined }): readonly string[] {
  return value === undefined ? [] : [`${label}: ${value}`];
}

/** The `start → end` text for a body's own times, or Google's. */
function whenOf({ event }: { event: calendar_v3.Schema$Event }): string | undefined {
  const start = parseEventTime({ point: event.start });
  const end = parseEventTime({ point: event.end });
  if (start === undefined && end === undefined) {
    return undefined;
  }
  return `${renderEventTime({ time: start })} → ${renderEventTime({ time: end })}`;
}

/**
 * The title line. Google sends no `summary` for an event nobody titled, and a change that leaves the title
 * alone proposes none: either way there is no title to show.
 */
function titleLine({ event }: { event: calendar_v3.Schema$Event }): readonly string[] {
  const { summary } = event;
  return summary == null ? [] : [`title: ${summary}`];
}

/** The location line. `location` is optional on an event, and a change that leaves it alone proposes none. */
function locationLine({ event }: { event: calendar_v3.Schema$Event }): readonly string[] {
  const { location } = event;
  return location == null ? [] : [`location: ${location}`];
}

/** The description line. `description` is optional on an event, and a change that leaves it alone proposes none. */
function descriptionLine({ event }: { event: calendar_v3.Schema$Event }): readonly string[] {
  const { description } = event;
  return description == null ? [] : [`description: ${description}`];
}

/**
 * The join line. Google sets the read-only `hangoutLink` only on an event that carries a Google Meet
 * conference, so a proposed body never has one and an event without Meet has none to show.
 */
function joinLine({ event }: { event: calendar_v3.Schema$Event }): readonly string[] {
  const { hangoutLink } = event;
  return hangoutLink == null ? [] : [`join: ${hangoutLink}`];
}

/** The lines describing an event body — the proposed one, or the one Google holds. */
function eventLines({ event }: { event: calendar_v3.Schema$Event }): readonly string[] {
  return [
    ...titleLine({ event }),
    ...line({ label: "when", value: whenOf({ event }) }),
    ...locationLine({ event }),
    ...descriptionLine({ event }),
    // The organiser's own fields are never null in the SDK's type: an unset address is already undefined.
    ...line({ label: "organiser", value: event.organizer?.email }),
    ...joinLine({ event }),
  ];
}

/**
 * One attendee's address as an outcome prints it. Google gives an attendee's address only "if available",
 * so an entry it sent without one prints `?`.
 */
function attendeeAddress({ attendee }: { attendee: calendar_v3.Schema$EventAttendee }): string {
  const { email } = attendee;
  if (email == null) {
    return "?";
  }
  return email;
}

/**
 * One attendee's answer as an outcome prints it. The SDK declares `responseStatus` optional, and an entry Google
 * sent back without one has given no answer the read-back can show, so it prints `?` beside the address.
 */
function attendeeAnswer({ attendee }: { attendee: calendar_v3.Schema$EventAttendee }): string {
  const { responseStatus } = attendee;
  if (responseStatus == null) {
    return "?";
  }
  return responseStatus;
}

/** The preview's current-state section for a change to an existing event. */
function currentLines({ plan }: { plan: CalendarWritePlan }): readonly string[] {
  const before = plan.intent.before;
  if (before === undefined) {
    return [];
  }
  return [
    "currently on the diary (as Google holds it):",
    ...eventLines({ event: before.event }).map((text) => `  ${text}`),
    `  attendees (besides you): ${plan.attendeesBefore.length === 0 ? "none" : plan.attendeesBefore.join(", ")}`,
    "",
  ];
}

/** The preview's proposed-change section. */
function changeLines({ plan }: { plan: CalendarWritePlan }): readonly string[] {
  const { mutation, intent } = plan;
  if (mutation.kind === "delete") {
    return ["proposed: CANCEL this event"];
  }
  const header = intent.form.kind === "book" ? "proposed event:" : "proposed change:";
  const after = plan.attendeesAfter.length === 0 ? "none" : plan.attendeesAfter.join(", ");
  return [
    header,
    ...eventLines({ event: mutation.body }).map((text) => `  ${text}`),
    ...(intent.form.kind === "respond" ? [`  your response: ${intent.form.response}`] : []),
    // The comment goes OUT to the organiser with the RSVP, so it is previewed verbatim rather than summarised
    // — a person approving a response has to see the words that will be attributed to the owner.
    ...(intent.form.kind === "respond" && intent.form.comment !== undefined
      ? [`  your comment: ${intent.form.comment}`]
      : []),
    ...(intent.form.kind === "book" || (intent.form.kind === "edit" && intent.form.attendees !== undefined)
      ? [`  attendees (besides you): ${after}`]
      : []),
    ...(plan.conferenceDataVersion === 1 ? ["  Google Meet: a link will be created"] : []),
  ];
}

/**
 * Render the preview and, for an outward write, the hold instruction.
 *
 * @param plan the planned write
 * @returns the text a person reads before deciding
 */
export function renderCalendarWritePlanText({ plan }: { plan: CalendarWritePlan }): string {
  const { intent } = plan;
  return [
    `calendar ${intent.form.kind}: ${intent.account}`,
    `intent: ${intent.intentId}`,
    `event id: ${intent.eventId}`,
    `reaches: ${plan.outward.outward ? `others — ${plan.outward.reasons.join("; ")}` : "nobody but you"}`,
    "residue:",
    ...plan.residue.map((text) => `  - ${text}`),
    "",
    ...currentLines({ plan }),
    ...changeLines({ plan }),
    "",
    `digest: ${plan.digest}`,
    ...(plan.outward.outward
      ? [
          `to send on the owner's yes: slopweaver calendar commit ${intent.intentId} --anchor <where the owner said yes>`,
        ]
      : []),
  ].join("\n");
}

/**
 * Render what an applied write left behind.
 *
 * @param outcome the read-back
 * @returns the text
 */
export function renderCalendarWriteOutcomeText({ outcome }: { outcome: CalendarWriteOutcome }): string {
  return [
    `calendar write ${outcome.status}: intent ${outcome.intentId} · event ${outcome.eventId}`,
    "residue:",
    ...outcome.residue.map((text) => `  - ${text}`),
    "",
    ...(outcome.event === undefined ? ["(no event to show)"] : eventLines({ event: outcome.event })),
    ...line({ label: "meet", value: outcome.meetLink }),
    ...(outcome.event?.attendees === undefined
      ? []
      : outcome.event.attendees.map(
          (attendee) => `  - ${attendeeAddress({ attendee })} · ${attendeeAnswer({ attendee })}`,
        )),
  ].join("\n");
}
