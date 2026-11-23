/**
 * The `queue-pinned` step's plan: the four moves the step makes on the real app, in order, and the address each hands
 * it.
 */
import { describe, expect, it } from "vitest";

import { type PinnedQueuePlannedMove, pinnedQueuePlan } from "../../../../../cli/commands/desktop/e2ePinnedQueue.js";

const BESIDE: PinnedQueuePlannedMove = { move: { kind: "beside" }, path: "/alignment", via: "deep-link" };

describe("pinnedQueuePlan", () => {
  it("goes beside, opens the voice's card, goes beside again, then follows the voice's Queue link", () => {
    expect(pinnedQueuePlan({ cardKey: "ask:a-row" })).toEqual([
      BESIDE,
      { move: { cardKey: "ask:a-row", kind: "card" }, path: "/queue?open=ask%3Aa-row", via: "voice-card" },
      BESIDE,
      { move: { kind: "queue" }, path: "/queue?context=slopweaver", via: "deep-link" },
    ]);
  });

  it("percent-encodes a card key carrying a query separator, so the card path names that one card", () => {
    expect(pinnedQueuePlan({ cardKey: "ask:a&b=c" })[1]!.path).toBe("/queue?open=ask%3Aa%26b%3Dc");
  });
});
