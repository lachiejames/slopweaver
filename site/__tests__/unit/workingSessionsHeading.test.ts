/*
 * The working-session heading says "Working now" only over a reading under ten minutes old, and the reading's own age
 * otherwise — never "now" over a reading weeks old.
 */
import { describe, expect, it } from "vitest";

import { workingSessionsHeading } from "../../lib/workingSessionsHeading";

const NOW = Date.parse("2026-11-20T08:00:00.000Z");

describe("workingSessionsHeading", () => {
  it("reads 'Working now' a millisecond under ten minutes, and the age at exactly ten", () => {
    expect([
      workingSessionsHeading({ nowMs: NOW, observedAtIso: "2026-11-20T07:50:00.001Z" }),
      workingSessionsHeading({ nowMs: NOW, observedAtIso: "2026-11-20T07:50:00.000Z" }),
    ]).toEqual(["Working now", "Working as of 10m ago"]);
  });

  it("names a weeks-old reading's age in days", () => {
    expect(workingSessionsHeading({ nowMs: NOW, observedAtIso: "2026-11-12T20:00:00.000Z" })).toBe(
      "Working as of 7.5d ago",
    );
  });

  it("names an instant it cannot read rather than calling the sessions current", () => {
    expect(workingSessionsHeading({ nowMs: NOW, observedAtIso: "2026-11-20T07:5xZ" })).toBe(
      "Working as of an unreadable instant",
    );
  });
});
