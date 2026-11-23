/*
 * A tile drawn from more than one reading ages the oldest of them, so a fresh channel never vouches for a figure a
 * read-once one shaped.
 */

import { describe, expect, it } from "vitest";

import type { LiveState } from "../../lib/liveState";
import { type AgedReading, oldestReadingOf } from "../../lib/readingAge";

const OWN: AgedReading = { observedAtIso: "2026-11-03T10:00:00.000Z", stampedByRoute: false, subject: "Next up" };

/**
 * A ready reading taken at one instant.
 *
 * @returns the reading
 */
function readyAt({ iso, stampedByRoute }: { iso: string; stampedByRoute: boolean }): LiveState<unknown> {
  return { fixture: undefined, observedAtIso: iso, phase: "ready", stampedByRoute, value: 1 };
}

describe("oldestReadingOf", () => {
  it("keeps the tile's own reading when it draws from nothing else", () => {
    expect(oldestReadingOf({ others: [], primary: OWN })).toEqual(OWN);
  });

  it("ages the board when it was read before the tile's own reading, carrying its route stamp", () => {
    expect(
      oldestReadingOf({
        others: [{ state: readyAt({ iso: "2026-11-03T09:40:00.000Z", stampedByRoute: true }), subject: "the board" }],
        primary: OWN,
      }),
    ).toEqual({ observedAtIso: "2026-11-03T09:40:00.000Z", stampedByRoute: true, subject: "the board" });
  });

  it("keeps the tile's own reading when the other one is newer", () => {
    expect(
      oldestReadingOf({
        others: [{ state: readyAt({ iso: "2026-11-03T10:05:00.000Z", stampedByRoute: false }), subject: "the board" }],
        primary: OWN,
      }),
    ).toEqual(OWN);
  });

  it("picks the oldest of several readings", () => {
    expect(
      oldestReadingOf({
        others: [
          { state: readyAt({ iso: "2026-11-03T09:50:00.000Z", stampedByRoute: false }), subject: "the board" },
          {
            state: readyAt({ iso: "2026-11-03T09:30:00.000Z", stampedByRoute: false }),
            subject: "the autonomy ledger",
          },
        ],
        primary: OWN,
      }).subject,
    ).toBe("the autonomy ledger");
  });

  it("adds nothing for a reading still loading or failed", () => {
    expect(
      oldestReadingOf({
        others: [
          { state: { phase: "loading" }, subject: "the board" },
          { state: { phase: "not-measured", why: "handover list timed out" }, subject: "the ledger" },
        ],
        primary: OWN,
      }),
    ).toEqual(OWN);
  });

  it("never treats another reading's unreadable instant as fresh", () => {
    expect(
      oldestReadingOf({
        others: [
          { state: readyAt({ iso: "2026-11-03T1x", stampedByRoute: false }), subject: "the board" },
          { state: readyAt({ iso: "2026-11-03T09:00:00.000Z", stampedByRoute: false }), subject: "the ledger" },
        ],
        primary: OWN,
      }).subject,
    ).toBe("the board");
  });

  it("keeps the tile's own unreadable instant rather than borrowing a readable one's age", () => {
    const unreadable: AgedReading = { observedAtIso: "not an instant", stampedByRoute: false, subject: "Next up" };
    expect(
      oldestReadingOf({
        others: [{ state: readyAt({ iso: "2026-11-03T09:00:00.000Z", stampedByRoute: false }), subject: "the board" }],
        primary: unreadable,
      }),
    ).toEqual(unreadable);
  });
});
