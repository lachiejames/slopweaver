/*
 * The owner's own entry on an event, found by the shared predicate rather than by address alone: the owner's alias kept on
 * an edit, dropped when a caller lists it, answered on an RSVP, and the organiser's alias dropped. It moved here
 * when the write plan's one test file was split by behaviour.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../../lib/result.js";
import { buildCalendarWritePlan } from "../../../../../live/calendar/writePlan.js";
import { intentFor, ZONE } from "./harness.js";

describe("the owner's own entry is found by the shared predicate, never by address alone", () => {
  it("keeps the owner's ALIAS attendee entry when an edit rewrites the whole set", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: {
              attendees: [{ email: "alias@x.test", responseStatus: "accepted", self: true }, { email: "a@x.test" }],
              organizer: { email: "alias@x.test", self: true },
            },
          },
          form: {
            attendees: ["b@x.test"],
            description: undefined,
            kind: "edit",
            location: undefined,
            title: undefined,
          },
        }),
        zone: ZONE,
      }),
    );
    const body = plan.mutation.kind === "patch" ? plan.mutation.body : {};
    expect(body.attendees).toStrictEqual([
      { email: "alias@x.test", responseStatus: "accepted", self: true },
      { email: "b@x.test" },
    ]);
  });

  it("drops the owner's ALIAS from an edit that explicitly lists it, rather than inviting them as a guest", () => {
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
          // A caller copying what `calendar read` printed writes the ALIAS, not the bound address.
          form: {
            attendees: ["alias@x.test", "b@x.test"],
            description: undefined,
            kind: "edit",
            location: undefined,
            title: undefined,
          },
        }),
        zone: ZONE,
      }),
    );
    expect(plan.attendeesAfter).toStrictEqual(["b@x.test"]);
    expect(plan.outward.reasons).toStrictEqual(["removes a@x.test", "reaches b@x.test"]);
    const body = plan.mutation.kind === "patch" ? plan.mutation.body : {};
    expect(body.attendees).toStrictEqual([{ email: "alias@x.test", self: true }, { email: "b@x.test" }]);
  });

  it("ANSWERS the owner's alias entry on an RSVP rather than adding a second owner", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            event: {
              attendees: [{ email: "alias@x.test", self: true }, { email: "boss@x.test" }],
              organizer: { email: "boss@x.test" },
            },
          },
          form: { comment: "running ten late", kind: "respond", response: "accepted" },
        }),
        zone: ZONE,
      }),
    );
    const body = plan.mutation.kind === "patch" ? plan.mutation.body : {};
    expect(body.attendees).toStrictEqual([
      { comment: "running ten late", email: "alias@x.test", responseStatus: "accepted", self: true },
      { email: "boss@x.test" },
    ]);
  });

  it("drops the ORGANISER's alias from an edit, keeps a standing guest's RSVP and invites a new one bare", () => {
    const plan = unwrap(
      buildCalendarWritePlan({
        intent: intentFor({
          before: {
            etag: '"1"',
            // The owner organises this one under an alias and is on it only as organiser, not as an attendee.
            event: {
              attendees: [{ email: "a@x.test", responseStatus: "accepted" }],
              organizer: { email: "alias@x.test", self: true },
            },
          },
          form: {
            attendees: ["alias@x.test", "a@x.test", "b@x.test"],
            description: undefined,
            kind: "edit",
            location: undefined,
            title: undefined,
          },
        }),
        zone: ZONE,
      }),
    );
    expect(plan.attendeesAfter).toStrictEqual(["a@x.test", "b@x.test"]);
    expect(plan.mutation).toStrictEqual({
      body: { attendees: [{ email: "a@x.test", responseStatus: "accepted" }, { email: "b@x.test" }] },
      etag: '"1"',
      kind: "patch",
    });
  });
});
