/*
 * `buildCalendarWritePlan` — the refusals and their allowed boundaries: an auto-declining out-of-office or focus
 * block against one that declines nothing, a series master against one occurrence, and an event nobody read against
 * a sparse stub or one with no attendee list, both of which still plan. It moved here when the write plan's one
 * test file was split by behaviour.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildCalendarWritePlan } from "../../../../../live/calendar/writePlan.js";
import { intentFor, ME, ZONE } from "./harness.js";

describe("buildCalendarWritePlan", () => {
  it("REFUSES an out-of-office event that auto-declines, because moving it mails refusals nothing here wrote", () => {
    const error = unwrapErr(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: {
              eventType: "outOfOffice",
              organizer: { email: ME, self: true },
              outOfOfficeProperties: { autoDeclineMode: "declineAllConflictingInvitations" },
            },
          },
          form: {
            kind: "reschedule",
            span: { allDay: false, end: "2026-09-18T10:30", start: "2026-09-18T10:00", zone: undefined },
          },
        }),
        zone: ZONE,
      }),
    );
    expect(error.code).toBe("INVALID_WRITE");
    expect(error.message).toContain("declineAllConflictingInvitations");
  });

  it("REFUSES a focus-time block that auto-declines, on the same grounds", () => {
    const error = unwrapErr(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: {
              eventType: "focusTime",
              focusTimeProperties: { autoDeclineMode: "declineOnlyNewConflictingInvitations" },
              organizer: { email: ME, self: true },
            },
          },
          form: { kind: "cancel" },
        }),
        zone: ZONE,
      }),
    );
    expect(error.code).toBe("INVALID_WRITE");
  });

  it("plans normally for an out-of-office block that declines NOTHING", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: {
              eventType: "outOfOffice",
              organizer: { email: ME, self: true },
              outOfOfficeProperties: { autoDeclineMode: "declineNone" },
            },
          },
          form: { kind: "cancel" },
        }),
        zone: ZONE,
      }),
    );
    expect(plan.mutation.kind).toBe("delete");
    expect(plan.outward.outward).toBe(false);
  });

  it("REFUSES a recurring SERIES master, whose exceptions can carry guests one snapshot cannot see", () => {
    const error = unwrapErr(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: { organizer: { email: ME, self: true }, recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"] },
          },
          form: { kind: "cancel" },
        }),
        zone: ZONE,
      }),
    );
    expect(error.code).toBe("INVALID_WRITE");
    expect(error.message).toContain("recurring SERIES");
  });

  it("plans normally for ONE occurrence of a series, which carries no rule of its own", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: { organizer: { email: ME, self: true }, recurringEventId: "master-1" },
          },
          form: { kind: "cancel" },
        }),
        zone: ZONE,
      }),
    );
    expect(plan.mutation.kind).toBe("delete");
    expect(plan.outward.outward).toBe(false);
  });

  it("plans an inward cancel of a stub Google sent with a null rule, a null organiser and no attendees", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: { etag: '"1"', event: { id: "evt-1", organizer: null, recurrence: null } },
          form: { kind: "cancel" },
        }),
        zone: ZONE,
      }),
    );
    expect(plan.mutation).toStrictEqual({ etag: '"1"', kind: "delete" });
    expect(plan.attendeesBefore).toStrictEqual([]);
    expect(plan.outward).toStrictEqual({ outward: false, reasons: [] });
  });

  it("answers an RSVP on an event with no attendee list by adding the owner's own entry", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: { etag: '"1"', event: { organizer: { email: "boss@x.test" } } },
          form: { comment: undefined, kind: "respond", response: "tentative" },
        }),
        zone: ZONE,
      }),
    );
    expect(plan.mutation).toStrictEqual({
      body: { attendees: [{ email: ME, responseStatus: "tentative", self: true }] },
      etag: '"1"',
      kind: "patch",
    });
  });

  it("refuses a change to an event nobody read, rather than planning a write with no ETag", () => {
    const error = unwrapErr(buildCalendarWritePlan({ intent: intentFor({ form: { kind: "cancel" } }), zone: ZONE }));
    expect(error.code).toBe("INVALID_WRITE");
    expect(error.message).toBe("cancel needs the event as Google holds it, and none was read");
  });
});
