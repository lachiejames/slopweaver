/**
 * The residue lines `./read.ts`'s listing and single-event documents owe their reader — what each read did NOT
 * establish, as prose. Pure: every line is computed from counts and fields the read already holds.
 */
import type { ParsedCalendarEvent } from "./parse.js";

/**
 * The residue lines a listing always owes its reader.
 *
 * @param complete whether every calendar was walked to its end rather than stopped at the cap
 * @param limit the event cap the walk ran under
 * @param freeBusyOnly how many listed events carried no title
 * @param calendarIds the calendars the window covered
 * @param unparsed how many events Google returned that carried no id and are not listed
 * @returns the residue lines, in print order
 */
export function listingResidue({
  complete,
  limit,
  freeBusyOnly,
  calendarIds,
  unparsed,
}: {
  complete: boolean;
  limit: number;
  freeBusyOnly: number;
  calendarIds: readonly string[];
  unparsed: number;
}): readonly string[] {
  return [
    ...(complete
      ? []
      : [`stopped at the ${String(limit)}-event cap — more events match this window and were not read`]),
    ...(unparsed > 0
      ? [`${String(unparsed)} event(s) Google returned carried no id and are not listed — the window is not complete`]
      : []),
    `this is ONE window across ${String(calendarIds.length)} calendar(s) (${calendarIds.join(", ")}); an event ` +
      "outside it, or on a calendar not named, is unread rather than absent",
    "recurring events are EXPANDED into instances here, so what is listed is what Google computed for this " +
      "window — the rule itself lives on the master and is not shown",
    ...(freeBusyOnly > 0
      ? [
          `${String(freeBusyOnly)} event(s) carried no title — either the grant sees that calendar as ` +
            "free/busy only, or the owner marked the event private. A blank hour here is still a busy one",
        ]
      : []),
  ];
}

/**
 * The residue lines a single-event read always owes its reader.
 *
 * @param event the event as read, whose recurrence, status and title decide which lines apply
 * @returns the residue lines, in print order
 */
export function eventResidue({ event }: { event: ParsedCalendarEvent }): readonly string[] {
  return [
    ...(event.recurrence.length > 0
      ? [
          "this is the recurring MASTER — its instances are computed from the rule above and are not listed " +
            "here; an instance the owner moved or cancelled is a separate event",
        ]
      : []),
    ...(event.recurringEventId !== undefined
      ? [`this is one INSTANCE of recurring event ${event.recurringEventId}; the rule lives on that master`]
      : []),
    ...(event.status === "cancelled"
      ? ["this event is CANCELLED — it is reported rather than hidden, and it did not happen"]
      : []),
    ...(event.summary === undefined
      ? [
          "this event carried no title — either the grant sees its calendar as free/busy only, or the owner " +
            "marked it private",
        ]
      : []),
    "attachments and the event's own change history are not read — this is the event as it stands now",
  ];
}
