/**
 * sweepSummary — a board with an unrouted ask on it must not open on two reassuring zeroes.
 *
 * The old line opened `sweep: 0 ready, 0 still working, …` and put `never-dispatched` sixth, so the one
 * reading that means "a card is standing in a public channel with nobody behind it" was the hardest to see.
 * The owner's ask: make it the loudest thing the sweep prints.
 */
import { describe, expect, it } from "vitest";

import { sweepSummaryLine } from "../../../../live/turn/sweepSummary.js";

const CLEAN = {
  checklistUpdateFailed: 0,
  expired: 0,
  failed: 0,
  ignored: 0,
  inReview: 0,
  phantom: 0,
  ready: 0,
  undispatched: 0,
  unrouted: 0,
  working: 0,
} as const;

describe("sweepSummaryLine", () => {
  it("keeps the familiar wording and order on a clean board", () => {
    expect(sweepSummaryLine({ counts: CLEAN })).toBe(
      "sweep: 0 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, " +
        "0 checklist-update-failed, 0 ignored",
    );
  });

  it("keeps that wording while work is healthy and nothing is outstanding", () => {
    expect(sweepSummaryLine({ counts: { ...CLEAN, ready: 1, working: 2 } })).toBe(
      "sweep: 1 ready, 2 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, " +
        "0 checklist-update-failed, 0 ignored",
    );
  });

  it("leads with UNROUTED the moment one ask is carded with nobody behind it", () => {
    const line = sweepSummaryLine({ counts: { ...CLEAN, unrouted: 1, working: 3 } });
    expect(line).toBe(
      "sweep: 1 UNROUTED, 0 NEVER-DISPATCHED — 1 ask(s) above need routing NOW; 0 ready, 3 still working, 0 in-review, " +
        "0 worker-failed, 0 phantom, 0 lease-expired, 0 checklist-update-failed, 0 ignored",
    );
  });

  it("never lets a held in-review ask make the board look alarmed", () => {
    // `in-review` is the one unrouted reading that is NOT something to act on: a session is inside the turn
    // and the bound was held. Counting it into `outstanding` would put "1 ask(s) above need routing NOW" on
    // a board whose only finding says in so many words DO NOT ROUTE.
    expect(sweepSummaryLine({ counts: { ...CLEAN, inReview: 1 } })).toBe(
      "sweep: 0 ready, 0 still working, 1 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, " +
        "0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    );
  });

  it("leads on a finalised never-dispatched ask too, with nothing unrouted beside it", () => {
    const line = sweepSummaryLine({ counts: { ...CLEAN, undispatched: 1 } });
    expect(line.startsWith("sweep: 0 UNROUTED, 1 NEVER-DISPATCHED — 1 ask(s) above need routing NOW;")).toBe(true);
  });

  it("adds the two together when both fired", () => {
    const line = sweepSummaryLine({ counts: { ...CLEAN, undispatched: 2, unrouted: 3 } });
    expect(line.startsWith("sweep: 3 UNROUTED, 2 NEVER-DISPATCHED — 5 ask(s) above need routing NOW;")).toBe(true);
  });

  it("still reports every healthy count on an alarmed board — the numbers never move, only the order", () => {
    const line = sweepSummaryLine({
      counts: {
        checklistUpdateFailed: 1,
        expired: 2,
        failed: 3,
        ignored: 9,
        inReview: 8,
        phantom: 4,
        ready: 5,
        undispatched: 0,
        unrouted: 6,
        working: 7,
      },
    });
    expect(line).toBe(
      "sweep: 6 UNROUTED, 0 NEVER-DISPATCHED — 6 ask(s) above need routing NOW; 5 ready, 7 still working, 8 in-review, " +
        "3 worker-failed, 4 phantom, 2 lease-expired, 1 checklist-update-failed, 9 ignored",
    );
  });
});
