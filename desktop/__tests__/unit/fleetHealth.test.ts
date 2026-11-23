/**
 * The sessions page's reading of `fleet health --json`: parsed rather than trusted, and an alias that is not a plain
 * name refused before a button could ever type it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { parseFleetHealth } from "../../src/fleetHealth";

/** A document as the CLI prints it, with any field replaced. */
function documentText({ over }: { over: Record<string, unknown> }): string {
  return JSON.stringify({
    capacity: { configured: 15, online: 2 },
    console: { port: 3000, state: "serving" },
    observedAtIso: "2026-10-04T10:00:00.000Z",
    reason: {
      code: "SEAT_STILL_WALLED",
      detail: "The seat relaunched on max-1's own login.",
      handStep: {
        action: { alias: "max-1", email: "max@example.com", kind: "claude-signin" },
        id: "claude-signin:max-1",
        label: "Sign in as max@example.com",
        note: "Sign in to Anthropic as max@example.com (max-1).",
      },
      headline: "Sign in to max@example.com (max-1).",
      raw: "Not logged in · Run /login",
    },
    schemaVersion: 1,
    seats: [
      {
        colour: "red",
        detail: "Signed out.",
        flashing: false,
        priority: "p1",
        role: "worker",
        rowId: "row-1",
        rowTitle: "The desktop app resumes the fleet",
        seatId: "s-1",
        sessionId: "s-1",
      },
    ],
    state: "down",
    unmapped: [],
    ...over,
  });
}

/** A reason whose hand step carries the given action. */
function reasonWith({ action }: { action: Record<string, unknown> }): Record<string, unknown> {
  return { code: "X", detail: "d", handStep: { action, id: "i", label: "l", note: "n" }, headline: "h" };
}

describe("parseFleetHealth", () => {
  it("reads the document off the last JSON line, past any advisory printed before it", () => {
    const health = unwrap(parseFleetHealth({ text: `stale seat advisory\n${documentText({ over: {} })}\n` }));
    expect(health.reason.handStep).toEqual({
      action: { alias: "max-1", email: "max@example.com", kind: "claude-signin" },
      id: "claude-signin:max-1",
      label: "Sign in as max@example.com",
      note: "Sign in to Anthropic as max@example.com (max-1).",
    });
    expect(health.capacity).toEqual({ configured: 15, online: 2 });
    expect(health.seats[0]!.rowTitle).toBe("The desktop app resumes the fleet");
  });

  it("refuses a sign-in alias that is not a plain name, so nothing a refusal printed is ever typed", () => {
    const text = documentText({
      over: { reason: reasonWith({ action: { alias: "x; rm -rf ~", kind: "claude-signin" } }) },
    });
    expect(unwrapErr(parseFleetHealth({ text })).message).toBe("fleet health printed a document malformed at reason");
  });

  it("refuses a hatch outside the closed set", () => {
    const text = documentText({ over: { reason: reasonWith({ action: { hatch: "PATH", kind: "policy-override" } }) } });
    expect(unwrapErr(parseFleetHealth({ text })).code).toBe("FLEET_MALFORMED");
  });

  it("keeps a hatch inside the closed set", () => {
    const text = documentText({
      over: { reason: reasonWith({ action: { hatch: "ALLOW_FABLE_OVERRIDE", kind: "policy-override" } }) },
    });
    expect(unwrap(parseFleetHealth({ text })).reason.handStep!.action).toEqual({
      hatch: "ALLOW_FABLE_OVERRIDE",
      kind: "policy-override",
    });
  });

  it("reads a seat recovery held as held, and an unmarked seat as not held", () => {
    const seat = { colour: "red", detail: "Held.", flashing: false, priority: "p1", role: "worker", rowTitle: "r" };
    const text = documentText({
      over: {
        seats: [
          { ...seat, held: true, seatId: "h" },
          { ...seat, seatId: "n" },
        ],
      },
    });
    expect(unwrap(parseFleetHealth({ text })).seats.map((parsed) => parsed.held)).toEqual([true, false]);
  });

  it("refuses a held mark that is anything but true", () => {
    const seat = { colour: "red", detail: "d", flashing: false, priority: "p1", role: "worker", rowTitle: "r" };
    const text = documentText({ over: { seats: [{ ...seat, held: "yes", seatId: "h" }] } });
    expect(unwrapErr(parseFleetHealth({ text })).message).toBe("fleet health printed a document malformed at seats[0]");
  });

  it("reads a supervisor marked live as live, and an unmarked one as not", () => {
    const seat = {
      colour: "red",
      detail: "Quiet.",
      flashing: false,
      priority: "p0",
      role: "supervisor",
      rowTitle: "r",
    };
    const text = documentText({
      over: {
        seats: [
          { ...seat, live: true, seatId: "l" },
          { ...seat, seatId: "n" },
        ],
      },
    });
    expect(unwrap(parseFleetHealth({ text })).seats.map((parsed) => parsed.live)).toEqual([true, false]);
  });

  it("refuses a live mark that is anything but true", () => {
    const seat = { colour: "red", detail: "d", flashing: false, priority: "p0", role: "supervisor", rowTitle: "r" };
    const text = documentText({ over: { seats: [{ ...seat, live: false, seatId: "l" }] } });
    expect(unwrapErr(parseFleetHealth({ text })).message).toBe("fleet health printed a document malformed at seats[0]");
  });

  it("names the seat that is malformed", () => {
    const text = documentText({ over: { seats: [{ colour: "blue" }] } });
    expect(unwrapErr(parseFleetHealth({ text })).message).toBe("fleet health printed a document malformed at seats[0]");
  });

  it("refuses output with no document at all", () => {
    expect(unwrapErr(parseFleetHealth({ text: "fleet health: config invalid\n" })).message).toBe(
      "fleet health printed a document malformed at the output (no JSON document)",
    );
  });

  it("reads a degraded fleet, and still refuses a state outside the set", () => {
    expect(unwrap(parseFleetHealth({ text: documentText({ over: { state: "degraded" } }) })).state).toBe("degraded");
    expect(unwrapErr(parseFleetHealth({ text: documentText({ over: { state: "sinking" } }) })).message).toBe(
      "fleet health printed a document malformed at state",
    );
  });

  it("carries the phase of an attempt underway", () => {
    const text = documentText({
      over: {
        recovery: { attemptId: "a", phase: "bringing the supervisor back", startedAtIso: "t" },
        state: "recovering",
      },
    });
    expect(unwrap(parseFleetHealth({ text })).recoveryPhase).toBe("bringing the supervisor back");
  });

  it("carries the newest finished attempt, so a deferral can be continued", () => {
    const lastAttempt = { attemptId: "a", episodeId: "e", outcome: "deferred" };
    expect(unwrap(parseFleetHealth({ text: documentText({ over: { lastAttempt } }) })).lastAttempt).toEqual(
      lastAttempt,
    );
  });

  it("carries the newest started attempt, finished or not, and reads its absence as none", () => {
    const newestAttempt = { attemptId: "a", episodeId: "e", finished: false };
    expect(unwrap(parseFleetHealth({ text: documentText({ over: { newestAttempt } }) })).newestAttempt).toEqual(
      newestAttempt,
    );
    expect(unwrap(parseFleetHealth({ text: documentText({ over: {} }) })).newestAttempt).toBeUndefined();
  });

  it("refuses a started attempt whose finish is not a boolean", () => {
    const newestAttempt = { attemptId: "a", episodeId: "e", finished: "no" };
    expect(unwrapErr(parseFleetHealth({ text: documentText({ over: { newestAttempt } }) })).message).toBe(
      "fleet health printed a document malformed at newestAttempt",
    );
  });

  describe("the supervisor's last sign of working", () => {
    const chair = {
      colour: "red",
      detail: "d",
      flashing: false,
      priority: "p0",
      role: "supervisor",
      rowTitle: "Supervisor",
      seatId: "supervisor",
    };

    it("reads both kinds of sign and the instant one has been expected from", () => {
      const text = documentText({
        over: {
          seats: [
            {
              ...chair,
              lastSignal: { atIso: "2026-10-10T02:16:04.366Z", kind: "swept" },
              signalExpectedSinceIso: "2026-10-09T23:27:54.336Z",
            },
            { ...chair, lastSignal: { atIso: "2026-10-09T21:14:57.174Z", kind: "reoriented" }, seatId: "s2" },
          ],
        },
      });
      const seats = unwrap(parseFleetHealth({ text })).seats;
      expect(seats.map((seat) => [seat.lastSignal, seat.signalExpectedSinceIso])).toEqual([
        [{ atIso: "2026-10-10T02:16:04.366Z", kind: "swept" }, "2026-10-09T23:27:54.336Z"],
        [{ atIso: "2026-10-09T21:14:57.174Z", kind: "reoriented" }, undefined],
      ]);
    });

    it("reads a seat with no sign as none", () => {
      const seat = unwrap(parseFleetHealth({ text: documentText({ over: { seats: [chair] } }) })).seats[0]!;
      expect(seat.lastSignal).toBeUndefined();
      expect(seat.signalExpectedSinceIso).toBeUndefined();
    });

    it("refuses a sign of a kind outside the set, or one whose instant does not parse", () => {
      for (const lastSignal of [
        { atIso: "2026-10-10T02:16:04.366Z", kind: "pinged" },
        { atIso: "later", kind: "swept" },
      ]) {
        const text = documentText({ over: { seats: [{ ...chair, lastSignal }] } });
        expect(unwrapErr(parseFleetHealth({ text })).message).toBe(
          "fleet health printed a document malformed at seats[0]",
        );
      }
    });

    it("refuses an expected-since instant that does not parse, which would throw where the page draws it", () => {
      const text = documentText({ over: { seats: [{ ...chair, signalExpectedSinceIso: "soon" }] } });
      expect(unwrapErr(parseFleetHealth({ text })).message).toBe(
        "fleet health printed a document malformed at seats[0]",
      );
    });
  });

  it("refuses a reading whose own instant does not parse", () => {
    expect(unwrapErr(parseFleetHealth({ text: documentText({ over: { observedAtIso: "t" } }) })).message).toBe(
      "fleet health printed a document malformed at observedAtIso",
    );
  });

  it("refuses a finished attempt whose outcome is outside the set", () => {
    const lastAttempt = { attemptId: "a", episodeId: "e", outcome: "maybe" };
    expect(unwrapErr(parseFleetHealth({ text: documentText({ over: { lastAttempt } }) })).message).toBe(
      "fleet health printed a document malformed at lastAttempt",
    );
  });
});
