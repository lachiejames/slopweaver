/*
 * `isWithinWindow`: whether a prior send's instant still falls inside the duplicate window, with the edge excluded
 * and an unparseable instant read as no evidence. It moved here when `sendReservation.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { isWithinWindow } from "../../../../../outbound/slack/sendReservation.js";
import { NOW, WINDOW } from "./harness.js";

describe("isWithinWindow", () => {
  it("counts a send from an hour ago", () => {
    expect(isWithinWindow({ firstSentIso: "2026-07-26T11:00:00.000Z", nowIso: NOW, windowHours: WINDOW })).toBe(true);
  });

  it("does NOT count a send from two days ago", () => {
    expect(isWithinWindow({ firstSentIso: "2026-07-24T12:00:00.000Z", nowIso: NOW, windowHours: WINDOW })).toBe(false);
  });

  it("does NOT count a send exactly at the window edge", () => {
    expect(isWithinWindow({ firstSentIso: "2026-07-25T12:00:00.000Z", nowIso: NOW, windowHours: WINDOW })).toBe(false);
  });

  it("counts a send one millisecond inside the window", () => {
    expect(isWithinWindow({ firstSentIso: "2026-07-25T12:00:00.001Z", nowIso: NOW, windowHours: WINDOW })).toBe(true);
  });

  it("treats an unparseable timestamp as NO evidence", () => {
    expect(isWithinWindow({ firstSentIso: "whenever", nowIso: NOW, windowHours: WINDOW })).toBe(false);
  });
});
