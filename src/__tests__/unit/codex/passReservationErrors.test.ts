/**
 * The pass reservation store's error factory — `codex/passReservationErrors.ts`. Each variant's `code` is what a
 * caller branches on and its `message` is what the routed pass prints, so both are held exactly.
 */
import { describe, expect, it } from "vitest";

import { CodexPassReservationErrors } from "../../../codex/passReservationErrors.js";

describe("CodexPassReservationErrors", () => {
  it("builds a fleet read failure that says an unreadable fleet is not evidence of a cap", () => {
    expect(CodexPassReservationErrors.fleetReadFailed({ reason: "spawn failed" })).toEqual({
      code: "PASS_RESERVATION_FLEET_READ_FAILED",
      message: "the Codex fleet could not be read (spawn failed), and an unreadable fleet is not evidence of a cap",
    });
  });

  it("builds a lock failure carrying the reason", () => {
    expect(CodexPassReservationErrors.lockUnavailable({ reason: "waited 5s" })).toEqual({
      code: "PASS_RESERVATION_LOCK_UNAVAILABLE",
      message: "the pass reservation lock did not come: waited 5s",
    });
  });

  it("builds a malformed-document failure joining every problem and keeping the path", () => {
    expect(
      CodexPassReservationErrors.storeMalformed({ path: "/h/doc.json", problems: ["a is bad", "b is bad"] }),
    ).toEqual({
      code: "PASS_RESERVATION_STORE_MALFORMED",
      message: "the pass reservation document /h/doc.json is not a reservation document: a is bad; b is bad",
      path: "/h/doc.json",
    });
  });

  it("builds an unreadable-document failure from an Error's message", () => {
    expect(CodexPassReservationErrors.storeUnreadable({ cause: new Error("EACCES"), path: "/h/doc.json" })).toEqual({
      code: "PASS_RESERVATION_STORE_UNREADABLE",
      message: "the pass reservation document /h/doc.json could not be read: EACCES",
      path: "/h/doc.json",
    });
  });

  it("builds a write failure from a non-Error cause by stringifying it", () => {
    expect(CodexPassReservationErrors.storeWriteFailed({ cause: "disk full", path: "/h/doc.json" })).toEqual({
      code: "PASS_RESERVATION_STORE_WRITE_FAILED",
      message: "the pass reservation document /h/doc.json could not be written: disk full",
      path: "/h/doc.json",
    });
  });
});
