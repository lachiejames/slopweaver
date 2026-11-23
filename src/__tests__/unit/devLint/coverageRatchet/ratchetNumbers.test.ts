/*
 * The coverage ratchet's two numbers: the rebaseline slack and the stale headroom, the second wider than the first.
 */
import { describe, expect, it } from "vitest";

import { RATCHET_SLACK_PCT, STALE_HEADROOM_PCT } from "../../../../devLint/coverageFloor.js";

describe("the ratchet's two numbers", () => {
  it("demands a rebaseline only past the slack, so a fresh floor is never stale on the next landing", () => {
    expect(RATCHET_SLACK_PCT).toBe(1);
    expect(STALE_HEADROOM_PCT).toBe(2);
    expect(STALE_HEADROOM_PCT).toBeGreaterThan(RATCHET_SLACK_PCT);
  });
});
