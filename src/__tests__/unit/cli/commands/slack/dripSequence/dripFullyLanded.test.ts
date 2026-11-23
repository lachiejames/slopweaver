/*
 * `dripFullyLanded`: true only when every message is sent or already there, and vacuously true for an empty drip.
 */
import { describe, expect, it } from "vitest";
import { dripFullyLanded } from "../../../../../../cli/commands/slack/dripCore.js";

describe("dripFullyLanded", () => {
  it("is true only when every message is sent or already there", () => {
    expect(
      dripFullyLanded({
        outcomes: [
          { fileIds: [], index: 0, state: "sent", ts: "1.1" },
          { index: 1, state: "already-sent", ts: "1.2" },
        ],
      }),
    ).toBe(true);
  });

  it("is false when any message failed, is unconfirmed, or was never attempted", () => {
    expect(dripFullyLanded({ outcomes: [{ error: "x", index: 0, state: "failed" }] })).toBe(false);
    expect(dripFullyLanded({ outcomes: [{ index: 0, reservedIso: "t", state: "unconfirmed" }] })).toBe(false);
    expect(dripFullyLanded({ outcomes: [{ index: 0, reason: "earlier-failure", state: "not-attempted" }] })).toBe(
      false,
    );
  });

  it("is vacuously true for an empty drip, which the schema makes unreachable anyway", () => {
    expect(dripFullyLanded({ outcomes: [] })).toBe(true);
  });
});
