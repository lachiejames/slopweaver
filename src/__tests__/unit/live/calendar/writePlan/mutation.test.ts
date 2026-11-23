/*
 * `buildCalendarWritePlan` — the mutation bodies: an inward and an outward booking, the owner dropped from their own
 * guest list, their `self` entry not counted as another person, the read-back ETag carried, and an RSVP answered on
 * the owner's own entry. It moved here when the write plan's one test file was split by behaviour.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../../lib/result.js";
import { buildCalendarWritePlan } from "../../../../../live/calendar/writePlan.js";
import { BOOK, intentFor, ME, ZONE } from "./harness.js";

describe("buildCalendarWritePlan", () => {
  it("plans an inward booking: an insert carrying the door-chosen id, sendUpdates none, no approval", () => {
    const plan = unwrap(buildCalendarWritePlan({ intent: intentFor({ eventId: "abc123", form: BOOK }), zone: ZONE }));
    expect(plan.mutation.kind).toBe("insert");
    expect(plan.sendUpdates).toBe("none");
    expect(plan.outward.outward).toBe(false);
    expect(plan.conferenceDataVersion).toBe(0);
    const body = plan.mutation.kind === "insert" ? plan.mutation.body : {};
    expect(body.id).toBe("abc123");
    expect(body.summary).toBe("Sync");
    expect(body.attendees).toBeUndefined();
  });

  it("plans an outward booking: attendees on the body, a Meet request keyed to the intent, sendUpdates all", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({ form: { ...BOOK, attendees: ["a@x.test"], meet: true } }),
        zone: ZONE,
      }),
    );
    expect(plan.sendUpdates).toBe("all");
    expect(plan.conferenceDataVersion).toBe(1);
    const body = plan.mutation.kind === "insert" ? plan.mutation.body : {};
    expect(body.attendees).toStrictEqual([{ email: "a@x.test" }]);
    expect(body.conferenceData?.createRequest?.requestId).toBe("intent-1");
  });

  it("drops the owner from their own attendee list rather than inviting them", () => {
    const plan = unwrap(
      buildCalendarWritePlan({ intent: intentFor({ form: { ...BOOK, attendees: [ME, "a@x.test"] } }), zone: ZONE }),
    );
    expect(plan.attendeesAfter).toStrictEqual(["a@x.test"]);
  });

  it("does not count the owner's own `self` attendee entry as another person, whatever address it carries", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: {
              attendees: [{ email: "alias@x.test", self: true }, { email: "a@x.test" }],
              organizer: { email: "alias@x.test", self: true },
            },
          },
          form: {
            kind: "reschedule",
            span: { allDay: false, end: "2026-09-20T11:30", start: "2026-09-20T11:00", zone: undefined },
          },
        }),
        zone: ZONE,
      }),
    );
    expect(plan.attendeesBefore).toStrictEqual(["a@x.test"]);
    expect(plan.attendeesAfter).toStrictEqual(["a@x.test"]);
    expect(plan.outward.reasons).toStrictEqual(["reaches a@x.test"]);
  });

  it("carries the read-back ETag onto a patch and a delete", () => {
    const before = { etag: '"etag-7"', event: { attendees: [{ email: "a@x.test" }] } };
    const edit = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before,
          form: { attendees: undefined, description: undefined, kind: "edit", location: undefined, title: "New" },
        }),
        zone: ZONE,
      }),
    );
    expect(edit.mutation).toStrictEqual({ body: { summary: "New" }, etag: '"etag-7"', kind: "patch" });
    const cancel = unwrap(
      buildCalendarWritePlan({ intent: intentFor({ before, form: { kind: "cancel" } }), zone: ZONE }),
    );
    expect(cancel.mutation).toStrictEqual({ etag: '"etag-7"', kind: "delete" });
  });

  it("answers the RSVP on the owner's own attendee entry and leaves everyone else's alone", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: {
              attendees: [
                { email: "a@x.test", responseStatus: "accepted" },
                { email: ME, responseStatus: "needsAction" },
              ],
            },
          },
          form: { comment: "on my way", kind: "respond", response: "declined" },
        }),
        zone: ZONE,
      }),
    );
    const body = plan.mutation.kind === "patch" ? plan.mutation.body : {};
    expect(body.attendees).toStrictEqual([
      { comment: "on my way", email: ME, responseStatus: "declined" },
      { email: "a@x.test", responseStatus: "accepted" },
    ]);
  });
});
