/**
 * The `queue-pinned` step's judge: one Queue tab, and the voice's card and Queue link both land in it.
 */
import { describe, expect, it } from "vitest";

import { type PinnedQueueSnapshot, pinnedQueueBreaks } from "../../../desktop/e2ePinnedQueue.js";

const PINNED_ONLY: PinnedQueueSnapshot = { pinnedAddress: "/queue", pinnedSelected: true, queuePages: 1, tabs: 1 };
const BESIDE: PinnedQueueSnapshot = { pinnedAddress: "/queue", pinnedSelected: false, queuePages: 1, tabs: 2 };
const KEY = "ask:a-row";

describe("pinnedQueueBreaks — beside", () => {
  it("holds when a page beside the Queue opens one tab in front of the pinned one", () => {
    expect(pinnedQueueBreaks({ after: BESIDE, before: PINNED_ONLY, move: { kind: "beside" } })).toEqual([]);
  });

  it("names a page beside the Queue that replaced the pinned tab's page rather than opening its own", () => {
    expect(pinnedQueueBreaks({ after: PINNED_ONLY, before: PINNED_ONLY, move: { kind: "beside" } })).toEqual([
      "a page beside the Queue left 1 tab(s), not 2",
      "a page beside the Queue did not come in front of the pinned tab",
    ]);
  });
});

describe("pinnedQueueBreaks — the voice's card", () => {
  it("holds when the card lands in the pinned tab and it is the one showing", () => {
    const after: PinnedQueueSnapshot = { ...BESIDE, pinnedAddress: "/queue?open=ask%3Aa-row", pinnedSelected: true };
    expect(pinnedQueueBreaks({ after, before: BESIDE, move: { cardKey: KEY, kind: "card" } })).toEqual([]);
  });

  it("names the measured defect: the card left in the tab in front, the pinned tab never shown", () => {
    expect(pinnedQueueBreaks({ after: BESIDE, before: BESIDE, move: { cardKey: KEY, kind: "card" } })).toEqual([
      "the voice's card did not take the owner over to the pinned Queue tab",
      "the pinned tab is not on ask:a-row (it reads /queue)",
    ]);
  });

  it("names a card that opened a duplicate Queue tab of its own", () => {
    const after: PinnedQueueSnapshot = { pinnedAddress: "/queue", pinnedSelected: false, queuePages: 2, tabs: 3 };
    expect(pinnedQueueBreaks({ after, before: BESIDE, move: { cardKey: KEY, kind: "card" } })).toEqual([
      "the voice's card left 3 tab(s), not 2: it opened a tab of its own",
      "the voice's card did not take the owner over to the pinned Queue tab",
      "the voice's card left 2 console page(s) on the Queue, not exactly one",
      "the pinned tab is not on ask:a-row (it reads /queue)",
    ]);
  });

  it("names a pinned tab whose address could not be read", () => {
    const after: PinnedQueueSnapshot = { ...BESIDE, pinnedAddress: undefined, pinnedSelected: true };
    expect(pinnedQueueBreaks({ after, before: BESIDE, move: { cardKey: KEY, kind: "card" } })).toEqual([
      "the pinned tab is not on ask:a-row (it reads undefined)",
    ]);
  });
});

describe("pinnedQueueBreaks — the voice's Queue link", () => {
  it("holds when the Queue link selects the pinned tab and opens no tab", () => {
    const after: PinnedQueueSnapshot = { ...BESIDE, pinnedSelected: true };
    expect(pinnedQueueBreaks({ after, before: BESIDE, move: { kind: "queue" } })).toEqual([]);
  });

  it("names the second measured defect: a second Queue tab in front", () => {
    const after: PinnedQueueSnapshot = { pinnedAddress: "/queue", pinnedSelected: false, queuePages: 2, tabs: 3 };
    expect(pinnedQueueBreaks({ after, before: BESIDE, move: { kind: "queue" } })).toEqual([
      "the voice's Queue link left 3 tab(s), not 2: it opened a tab of its own",
      "the voice's Queue link did not take the owner over to the pinned Queue tab",
      "the voice's Queue link left 2 console page(s) on the Queue, not exactly one",
    ]);
  });
});
