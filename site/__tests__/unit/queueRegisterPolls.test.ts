/**
 * Every register the Queue counts is re-read on an open page: a board read once per mount leaves a desktop-app Queue
 * left open saying "updated 18 hours ago" over asks that old.
 */
import { describe, expect, it } from "vitest";

import { liveVerbFor } from "../../lib/liveVerbs";
import {
  BOARD_POLL_MS,
  FAST_POLL_MS,
  QUEUE_FIRST_READ_BOUNDS_MS,
  QUEUE_REGISTER_POLLS,
} from "../../lib/queueRegisterPolls";

const polls: Readonly<Record<string, number | undefined>> = QUEUE_REGISTER_POLLS;

describe("QUEUE_REGISTER_POLLS", () => {
  it("names the seven registers the Queue counts", () => {
    expect(Object.keys(polls).toSorted()).toEqual([
      "board",
      "drafts",
      "hands",
      "import-questions",
      "landing-reading",
      "review-drafts",
      "slack-drafts",
    ]);
  });

  it("re-reads every register within a minute, so none ages without bound on an open page", () => {
    const unpolled = Object.entries(polls).filter(([, everyMs]) => everyMs === undefined || everyMs > 60_000);
    expect(unpolled).toEqual([]);
  });

  it("polls the board once a minute and the rest on the fast lane", () => {
    expect(polls["board"]).toBe(60_000);
    expect(BOARD_POLL_MS).toBe(60_000);
    expect(polls["hands"]).toBe(FAST_POLL_MS);
    expect(FAST_POLL_MS).toBe(20_000);
  });
});

describe("QUEUE_FIRST_READ_BOUNDS_MS", () => {
  const bounds = Object.entries(QUEUE_FIRST_READ_BOUNDS_MS);

  it("bounds every register the Queue counts, and the readings that can take a card off it or decide one", () => {
    expect(bounds.length).toBeGreaterThan(0);
    expect(Object.keys(polls).filter((slug) => !(slug in QUEUE_FIRST_READ_BOUNDS_MS))).toEqual([]);
    expect(bounds.map(([slug]) => slug).toSorted()).toEqual([
      "board",
      "drafts",
      "hands",
      "import-questions",
      "landing-reading",
      "review-drafts",
      "reviewers",
      "slack-drafts",
      "standing-asks",
      "talk-cards",
      "talk-steers",
      "workstreams",
    ]);
  });

  it("holds each reading to exactly its own verb's route timeout", () => {
    const drift = bounds
      .map(([slug, boundMs]) => ({ boundMs, slug, timeoutMs: liveVerbFor({ slug })!.timeoutMs }))
      .filter(({ boundMs, timeoutMs }) => boundMs !== timeoutMs);
    expect(drift).toEqual([]);
    expect([QUEUE_FIRST_READ_BOUNDS_MS.board, QUEUE_FIRST_READ_BOUNDS_MS.hands]).toEqual([90_000, 20_000]);
  });
});
