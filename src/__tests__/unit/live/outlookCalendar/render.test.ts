/**
 * The human renderings of the `outlook-calendar` reads (`live/outlookCalendar/render.ts`), over events read
 * through the real parser: what each listing names, and what each absence prints as. Every value is synthetic.
 */
import { describe, expect, it } from "vitest";

import { parseOutlookEvent } from "../../../../live/outlookCalendar/parse.js";
import type { OutlookCalendarSummary } from "../../../../live/outlookCalendar/read.js";
import {
  renderOutlookCalendarEventText,
  renderOutlookCalendarsText,
  renderOutlookCalendarWindowText,
} from "../../../../live/outlookCalendar/render.js";
import type { GraphEvent } from "../../../../live/outlookCalendar/wire.js";

/** A timed event with one named guest and one unnamed optional room that has not replied. */
function wireEvent({ over = {} }: { over?: Partial<GraphEvent> } = {}): GraphEvent {
  return {
    attendees: [
      {
        emailAddress: { address: "guest@example.test", name: "Guest One" },
        status: { response: "accepted", time: "2001-01-01T00:00:00Z" },
        type: "required",
      },
      { emailAddress: { address: "room@example.test" }, type: "resource" },
    ],
    body: { content: "Agenda", contentType: "text" },
    end: { dateTime: "2001-01-08T08:30:00", timeZone: "UTC" },
    id: "event-1",
    isAllDay: false,
    isOrganizer: false,
    organizer: { emailAddress: { address: "host@example.test", name: "Host" } },
    start: { dateTime: "2001-01-08T07:30:00", timeZone: "UTC" },
    subject: "Planning",
    ...over,
  };
}

/** One calendar summary, overridable. */
function calendar({ over = {} }: { over?: Partial<OutlookCalendarSummary> } = {}): OutlookCalendarSummary {
  return {
    canEdit: true,
    canViewPrivateItems: true,
    color: undefined,
    id: "cal-1",
    isDefault: true,
    name: "Calendar",
    ownerName: undefined,
    ...over,
  };
}

describe("renderOutlookCalendarsText", () => {
  it("names each calendar with its marks and id, and an unnamed one as such", () => {
    const text = renderOutlookCalendarsText({
      calendars: [calendar(), calendar({ over: { canEdit: false, id: "cal-2", isDefault: false, name: undefined } })],
    });

    expect(text).toBe("Calendar (default)\n  id: cal-1\n(unnamed) (read-only)\n  id: cal-2");
  });

  it("says so when the account holds no calendar", () => {
    expect(renderOutlookCalendarsText({ calendars: [] })).toBe("no calendars on this account");
  });
});

describe("renderOutlookCalendarEventText", () => {
  it("prints each attendee's name and reply, and an unnamed one that has not replied as such", () => {
    const event = parseOutlookEvent({ calendarId: "cal-1", event: wireEvent() });

    const lines = renderOutlookCalendarEventText({ event }).split("\n");

    expect(lines[0]).toBe("Planning");
    expect(lines).toContain("organiser: Host");
    expect(lines).toContain("attendees (2):");
    expect(lines).toContain("  - Guest One — accepted");
    expect(lines).toContain("  - (unnamed) — no reply (resource)");
  });

  it("names the organiser by address when Graph sent no name", () => {
    const event = parseOutlookEvent({
      calendarId: "cal-1",
      event: wireEvent({ over: { organizer: { emailAddress: { address: "host@example.test" } } } }),
    });

    expect(renderOutlookCalendarEventText({ event }).split("\n")).toContain("organiser: host@example.test");
  });
});

describe("renderOutlookCalendarWindowText", () => {
  it("heads the listing with its count and window, and closes on the residue", () => {
    const event = parseOutlookEvent({ calendarId: "cal-1", event: wireEvent() });

    const text = renderOutlookCalendarWindowText({
      window: {
        calendar: "default",
        complete: true,
        endIso: "2001-01-09T00:00:00.000Z",
        events: [event],
        residue: ["one page read"],
        startIso: "2001-01-08T00:00:00.000Z",
      },
    });
    const lines = text.split("\n");

    expect(lines[0]).toBe("1 event(s) on default, 2001-01-08T00:00:00.000Z to 2001-01-09T00:00:00.000Z");
    expect(lines.at(-2)).toBe("residue:");
    expect(lines.at(-1)).toBe("  - one page read");
  });
});
