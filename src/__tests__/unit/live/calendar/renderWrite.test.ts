/**
 * Unit: the preview a person reads before approving a calendar write. Pure — a plan in, text out.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../lib/result.js";
import { renderCalendarWriteOutcomeText, renderCalendarWritePlanText } from "../../../../live/calendar/renderWrite.js";
import { buildCalendarWritePlan, type CalendarIntent } from "../../../../live/calendar/writePlan.js";
import type { CalendarWriteForm } from "../../../../outbound/calendar/form.js";

const ME = "me@x.test";
const ZONE = "Australia/Melbourne";

/** An intent over a form, with the snapshot every kind but a booking carries. */
function intentFor({ form }: { form: CalendarWriteForm }): CalendarIntent {
  return {
    account: ME,
    before: {
      etag: '"1"',
      event: {
        attendees: [{ email: ME, self: true }, { email: "boss@x.test" }],
        organizer: { email: "boss@x.test" },
        summary: "Review",
      },
    },
    calendarId: "primary",
    createdAtIso: "2026-09-13T04:00:00.000Z",
    eventId: "evt-1",
    form,
    intentId: "intent-1",
    state: "pending",
    version: 1,
  };
}

describe("renderCalendarWritePlanText", () => {
  it("previews an RSVP's COMMENT verbatim — the words the organiser will see attributed to the owner", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({ form: { comment: "can we push to 3pm?", kind: "respond", response: "tentative" } }),
        zone: ZONE,
      }),
    );
    const text = renderCalendarWritePlanText({ plan });
    expect(text).toContain("your response: tentative");
    expect(text).toContain("your comment: can we push to 3pm?");
  });

  it("prints no comment line when the RSVP carries none", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({ form: { comment: undefined, kind: "respond", response: "accepted" } }),
        zone: ZONE,
      }),
    );
    const text = renderCalendarWritePlanText({ plan });
    expect(text).toContain("your response: accepted");
    expect(text.includes("your comment:")).toBe(false);
  });
});

describe("renderCalendarWriteOutcomeText", () => {
  it("prints every field the read-back carries, and `?` for an attendee Google sent with no address", () => {
    const text = renderCalendarWriteOutcomeText({
      outcome: {
        event: {
          attendees: [{ email: "bob@x.test", responseStatus: "accepted" }, { displayName: "Nameless" }],
          description: "Agenda",
          hangoutLink: "https://meet.google.com/abc",
          location: "Room 1",
          organizer: { email: "boss@x.test" },
          summary: "Sync",
        },
        eventId: "evt-1",
        intentId: "intent-1",
        meetLink: "https://meet.google.com/abc",
        residue: [],
        status: "applied",
      },
    });
    expect(text).toBe(
      [
        "calendar write applied: intent intent-1 · event evt-1",
        "residue:",
        "",
        "title: Sync",
        "location: Room 1",
        "description: Agenda",
        "organiser: boss@x.test",
        "join: https://meet.google.com/abc",
        "meet: https://meet.google.com/abc",
        "  - bob@x.test · accepted",
        "  - ? · ?",
      ].join("\n"),
    );
  });

  it("prints no line for a field Google sent null, nor for an organiser it sent null", () => {
    const text = renderCalendarWriteOutcomeText({
      outcome: {
        event: {
          attendees: [{ email: null, responseStatus: null }],
          description: null,
          hangoutLink: null,
          location: null,
          organizer: null,
          summary: null,
        },
        eventId: "evt-1",
        intentId: "intent-1",
        meetLink: undefined,
        residue: ["read-back was partial"],
        status: "uncertain",
      },
    });
    expect(text).toBe(
      [
        "calendar write uncertain: intent intent-1 · event evt-1",
        "residue:",
        "  - read-back was partial",
        "",
        "  - ? · ?",
      ].join("\n"),
    );
  });

  it("prints the address and the answer each on its own, `?` standing in for only the one Google left out", () => {
    const text = renderCalendarWriteOutcomeText({
      outcome: {
        event: { attendees: [{ email: "bob@x.test" }, { responseStatus: "declined" }] },
        eventId: "evt-1",
        intentId: "intent-1",
        meetLink: undefined,
        residue: [],
        status: "applied",
      },
    });
    expect(text.split("\n").slice(-2)).toStrictEqual(["  - bob@x.test · ?", "  - ? · declined"]);
  });
});
