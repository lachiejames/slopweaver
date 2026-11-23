/**
 * `turn review --poll --wait` keeps reading only while the reviewer is working; every other truth is a state
 * another read will not change.
 */
import { describe, expect, it } from "vitest";

import { reviewWaitSettled } from "../../../../live/turn/reviewPoll.js";

describe("reviewWaitSettled", () => {
  it("keeps waiting on a working reviewer", () => {
    expect(reviewWaitSettled({ truth: { kind: "working", reconciledDoubt: undefined } })).toBe(false);
  });

  it("stops on a verdict, whether or not its digest matches", () => {
    expect(
      reviewWaitSettled({ truth: { digestMatches: false, kind: "verdict", outcome: "clean", path: "/tmp/v.json" } }),
    ).toBe(true);
  });

  it("stops on a malformed verdict file", () => {
    expect(reviewWaitSettled({ truth: { kind: "unreadable", reason: "not JSON" } })).toBe(true);
  });

  it("stops on a pickup nobody saw land", () => {
    expect(
      reviewWaitSettled({
        truth: { kind: "delivery-unwitnessed", reason: "no record", waitedMinutes: 6, workspaceRef: "workspace:9" },
      }),
    ).toBe(true);
  });
});
