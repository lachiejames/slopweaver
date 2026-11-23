/**
 * Unit: the residue lines a calendar listing and a single-event read owe their reader — which line each count or
 * field adds, and the lines that are always there.
 */
import { describe, expect, it } from "vitest";

import type { ParsedCalendarEvent } from "../../../../live/calendar/parse.js";
import { eventResidue, listingResidue } from "../../../../live/calendar/readResidue.js";

const ALWAYS_LISTING = [
  "this is ONE window across 1 calendar(s) (primary); an event outside it, or on a calendar not named, is unread " +
    "rather than absent",
  "recurring events are EXPANDED into instances here, so what is listed is what Google computed for this window — " +
    "the rule itself lives on the master and is not shown",
];

const ALWAYS_EVENT = "attachments and the event's own change history are not read — this is the event as it stands now";

function event(over: Partial<ParsedCalendarEvent> = {}): ParsedCalendarEvent {
  return {
    attendees: [],
    calendarId: "primary",
    conferenceUrl: undefined,
    createdIso: undefined,
    creatorEmail: undefined,
    description: undefined,
    end: undefined,
    htmlLink: undefined,
    iCalUID: undefined,
    id: "e1",
    location: undefined,
    organizerEmail: undefined,
    recurrence: [],
    recurringEventId: undefined,
    start: undefined,
    status: "confirmed",
    summary: "Stand-up",
    transparency: undefined,
    updatedIso: undefined,
    visibility: undefined,
    ...over,
  };
}

describe("listingResidue", () => {
  it("owes only the window and recurrence lines for a complete, fully titled listing", () => {
    expect(
      listingResidue({ calendarIds: ["primary"], complete: true, freeBusyOnly: 0, limit: 500, unparsed: 0 }),
    ).toEqual(ALWAYS_LISTING);
  });

  it("names the cap, the id-less events and the untitled ones, in that order around the fixed lines", () => {
    expect(
      listingResidue({ calendarIds: ["primary"], complete: false, freeBusyOnly: 2, limit: 500, unparsed: 1 }),
    ).toEqual([
      "stopped at the 500-event cap — more events match this window and were not read",
      "1 event(s) Google returned carried no id and are not listed — the window is not complete",
      ...ALWAYS_LISTING,
      "2 event(s) carried no title — either the grant sees that calendar as free/busy only, or the owner marked the " +
        "event private. A blank hour here is still a busy one",
    ]);
  });
});

describe("eventResidue", () => {
  it("owes only the history line for a plain, titled, confirmed event", () => {
    expect(eventResidue({ event: event() })).toEqual([ALWAYS_EVENT]);
  });

  it("names an instance of a series, a cancellation and a missing title", () => {
    expect(
      eventResidue({ event: event({ recurringEventId: "series1", status: "cancelled", summary: undefined }) }),
    ).toEqual([
      "this is one INSTANCE of recurring event series1; the rule lives on that master",
      "this event is CANCELLED — it is reported rather than hidden, and it did not happen",
      "this event carried no title — either the grant sees its calendar as free/busy only, or the owner marked it " +
        "private",
      ALWAYS_EVENT,
    ]);
  });

  it("names a recurring master", () => {
    expect(eventResidue({ event: event({ recurrence: ["RRULE:FREQ=WEEKLY"] }) })[0]).toBe(
      "this is the recurring MASTER — its instances are computed from the rule above and are not listed here; an " +
        "instance the owner moved or cancelled is a separate event",
    );
  });
});
