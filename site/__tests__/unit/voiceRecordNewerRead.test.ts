/**
 * Which record read the Queue tools hold: an older call's slow read landing last never replaces a newer one under a call
 * still answering from it.
 */
import { describe, expect, it } from "vitest";

import { newerRead } from "../../lib/voiceRecordQueue";

describe("newerRead", () => {
  it("holds the first read to land", () => {
    expect(newerRead({ held: undefined, read: { label: "a", startedAtMs: 0 } })).toEqual({
      label: "a",
      startedAtMs: 0,
    });
  });

  it("keeps a newer read when an older one lands after it, and takes a newer one over an older", () => {
    const older = { label: "a", startedAtMs: 0 };
    const newer = { label: "b", startedAtMs: 1100 };
    expect(newerRead({ held: newer, read: older })).toBe(newer);
    expect(newerRead({ held: older, read: newer })).toBe(newer);
  });

  it("takes the read landing now on a tie, two calls sharing one read", () => {
    const first = { label: "a", startedAtMs: 500 };
    const second = { label: "b", startedAtMs: 500 };
    expect(newerRead({ held: first, read: second })).toBe(second);
  });
});
