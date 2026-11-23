/*
 * The business clock: Monday to Friday on the owner's Melbourne clock, never a weekend, with the day boundary read
 * from the zone rather than computed from an offset.
 */
import { describe, expect, it } from "vitest";

import { businessInstantAfter, businessMsBetween } from "../../../review/businessTime.js";

/** Milliseconds in one hour. */
const HOUR = 60 * 60 * 1000;

describe("businessMsBetween", () => {
  it("starts a Sunday-night post's clock at Monday's local midnight — the late-Sunday shape", () => {
    // Sunday evening → Monday night, Melbourne time: only Monday counts.
    expect(businessMsBetween({ fromIso: "2026-09-27T11:30:21.000Z", toIso: "2026-09-28T13:39:00.000Z" })).toBe(
      23 * HOUR + 39 * 60 * 1000,
    );
  });

  it("counts nothing across a whole weekend", () => {
    // Saturday morning → Sunday night, Melbourne time.
    expect(businessMsBetween({ fromIso: "2026-09-25T23:00:00.000Z", toIso: "2026-09-27T12:00:00.000Z" })).toBe(0);
  });

  it("counts a full weekday as 24 hours", () => {
    // Tuesday morning → Wednesday morning, Melbourne time.
    expect(businessMsBetween({ fromIso: "2026-09-29T00:00:00.000Z", toIso: "2026-09-30T00:00:00.000Z" })).toBe(
      24 * HOUR,
    );
  });

  it("reads Monday's midnight on the far side of the October daylight-saving change", () => {
    // Friday noon (standard time) → Monday noon (daylight time): Friday's back half plus Monday's front half.
    expect(businessMsBetween({ fromIso: "2026-10-02T02:00:00.000Z", toIso: "2026-10-05T01:00:00.000Z" })).toBe(
      24 * HOUR,
    );
  });

  it("answers zero when the end is not after the start", () => {
    expect(businessMsBetween({ fromIso: "2026-09-29T00:00:00.000Z", toIso: "2026-09-28T00:00:00.000Z" })).toBe(0);
  });

  it("answers undefined for an instant it cannot read, never zero", () => {
    expect(businessMsBetween({ fromIso: "not a time", toIso: "2026-09-28T00:00:00.000Z" })).toBeUndefined();
  });
});

describe("businessInstantAfter", () => {
  it("lands a Friday-afternoon day on Monday afternoon, never the Saturday", () => {
    // Friday late afternoon + 24 business hours → Monday late afternoon, Melbourne time.
    expect(businessInstantAfter({ businessMs: 24 * HOUR, fromIso: "2026-09-25T07:00:00.000Z" })).toBe(
      "2026-09-28T07:00:00.000Z",
    );
  });

  it("starts a Saturday clock at Monday's midnight, so its day ends Tuesday's", () => {
    // Saturday morning → Tuesday's local midnight.
    expect(businessInstantAfter({ businessMs: 24 * HOUR, fromIso: "2026-09-25T23:00:00.000Z" })).toBe(
      "2026-09-28T14:00:00.000Z",
    );
  });

  it("stops at Saturday's midnight when the budget runs out exactly at a Friday's end", () => {
    // Friday's local midnight + 24 business hours → Saturday's local midnight, the first instant it is whole.
    expect(businessInstantAfter({ businessMs: 24 * HOUR, fromIso: "2026-09-24T14:00:00.000Z" })).toBe(
      "2026-09-25T14:00:00.000Z",
    );
  });

  it("reads Monday's hours on the far side of the October daylight-saving change", () => {
    // Friday noon (standard time) + 24 business hours → Monday noon (daylight time) — the inverse of the case above.
    expect(businessInstantAfter({ businessMs: 24 * HOUR, fromIso: "2026-10-02T02:00:00.000Z" })).toBe(
      "2026-10-05T01:00:00.000Z",
    );
  });

  it("is the inverse of businessMsBetween", () => {
    const fromIso = "2026-09-25T07:00:00.000Z";
    const toIso = businessInstantAfter({ businessMs: 30 * HOUR, fromIso })!;

    expect(businessMsBetween({ fromIso, toIso })).toBe(30 * HOUR);
  });

  it("answers the start itself for a budget of zero", () => {
    expect(businessInstantAfter({ businessMs: 0, fromIso: "2026-09-26T01:00:00.000Z" })).toBe(
      "2026-09-26T01:00:00.000Z",
    );
  });

  it("answers undefined for a start it cannot read", () => {
    expect(businessInstantAfter({ businessMs: HOUR, fromIso: "not a time" })).toBeUndefined();
  });
});
