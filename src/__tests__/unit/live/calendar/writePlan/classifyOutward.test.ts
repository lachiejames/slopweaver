/*
 * `classifyOutward` — the outward classification that decides whether the door holds: who a change reaches or
 * removes, an organiser who is somebody else, a room, an RSVP, and the attendees this door cannot read. It moved
 * here when the write plan's one test file was split by behaviour.
 */
import { describe, expect, it } from "vitest";
import { classifyOutward } from "../../../../../live/calendar/writePlan.js";
import { BOOK, intentFor, ME } from "./harness.js";

describe("classifyOutward", () => {
  it("is inward only when the change provably reaches nobody", () => {
    expect(
      classifyOutward({ attendeesAfter: [], attendeesBefore: [], intent: intentFor({ form: BOOK }) }),
    ).toStrictEqual({
      outward: false,
      reasons: [],
    });
  });

  it("is outward when anyone is on the event after", () => {
    const verdict = classifyOutward({
      attendeesAfter: ["a@x.test"],
      attendeesBefore: [],
      intent: intentFor({ form: { ...BOOK, attendees: ["a@x.test"] } }),
    });
    expect(verdict.outward).toBe(true);
    expect(verdict.reasons).toStrictEqual(["reaches a@x.test"]);
  });

  it("is outward when the change REMOVES someone, even though nobody is left", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: ["a@x.test"],
      intent: intentFor({
        before: { etag: '"1"', event: { attendees: [{ email: "a@x.test" }] } },
        form: { attendees: [], description: undefined, kind: "edit", location: undefined, title: undefined },
      }),
    });
    expect(verdict.outward).toBe(true);
    expect(verdict.reasons).toStrictEqual(["removes a@x.test"]);
  });

  it("is outward when Google omitted the attendee list, so who it reaches cannot be established", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        before: { etag: '"1"', event: { attendeesOmitted: true } },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.outward).toBe(true);
    expect(verdict.reasons).toStrictEqual([
      "Google omitted attendees from the read, so who this reaches cannot be established",
    ]);
  });

  it("HOLDS when an attendee has no address this door can read, rather than dropping them", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        before: { etag: '"1"', event: { attendees: [{ displayName: "A Room Booking System" }] } },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.outward).toBe(true);
    expect(verdict.reasons).toStrictEqual([
      "1 person on the event has no address this door can read, so who this reaches cannot be established",
    ]);
  });

  it("HOLDS when the ORGANISER has no address either, and counts both", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        before: {
          etag: '"1"',
          event: { attendees: [{ displayName: "Nameless" }], organizer: { displayName: "Also nameless" } },
        },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.reasons).toStrictEqual([
      "2 people on the event have no address this door can read, so who this reaches cannot be established",
    ]);
  });

  it("does not count the owner's OWN unnamed `self` entry as unreadable", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        before: { etag: '"1"', event: { attendees: [{ self: true }], organizer: { self: true } } },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.outward).toBe(false);
    expect(verdict.reasons).toStrictEqual([]);
  });

  it("is outward when the organiser is somebody else", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        before: { etag: '"1"', event: { organizer: { email: "boss@x.test" } } },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.reasons).toStrictEqual(["the organiser is boss@x.test, not you"]);
  });

  it("is INWARD when Google marks the organiser `self`, even under an address the account is not bound to", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        // An alias on the owner's own calendar: the address is not `ME`, and Google says it is the owner anyway.
        before: { etag: '"1"', event: { organizer: { email: "alias@x.test", self: true } } },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.outward).toBe(false);
    expect(verdict.reasons).toStrictEqual([]);
  });

  it("is outward for a room, even with no human attendee", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        before: { etag: '"1"', event: { attendees: [{ email: "room@x.test", resource: true }] } },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.outward).toBe(true);
    expect(verdict.reasons).toContain("a room or resource is on the event");
  });

  it("is ALWAYS outward for an RSVP, because the organiser sees it", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: [],
      intent: intentFor({
        before: { etag: '"1"', event: { attendees: [{ email: ME, self: true }] } },
        form: { comment: undefined, kind: "respond", response: "accepted" },
      }),
    });
    expect(verdict.outward).toBe(true);
    expect(verdict.reasons).toContain("your RSVP is seen by the organiser");
  });

  it("names who a cancellation tells, from the attendees BEFORE", () => {
    const verdict = classifyOutward({
      attendeesAfter: [],
      attendeesBefore: ["a@x.test", "b@x.test"],
      intent: intentFor({
        before: { etag: '"1"', event: { attendees: [{ email: "a@x.test" }, { email: "b@x.test" }] } },
        form: { kind: "cancel" },
      }),
    });
    expect(verdict.reasons).toContain("tells a@x.test, b@x.test the meeting is cancelled");
  });
});
