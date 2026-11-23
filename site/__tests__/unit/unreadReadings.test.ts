/*
 * A judgement's inputs sorted into still-reading and failed, so /fleet's badge draws a spinner or a staleness mark
 * rather than "not measured" while a reading it stands on is not in hand.
 */

import { describe, expect, it } from "vitest";

import type { LiveState } from "../../lib/liveState";
import { unreadReadingsOf } from "../../lib/unreadReadings";

const READY: LiveState<number> = {
  fixture: undefined,
  observedAtIso: "2026-10-11T01:00:00.000Z",
  phase: "ready",
  stampedByRoute: true,
  value: 3,
};

describe("unreadReadingsOf", () => {
  it("names a first read in flight as loading and a failed one as a fact with its reason", () => {
    expect(
      unreadReadingsOf({
        readings: [
          { state: { phase: "loading" }, subject: "the machine capacity reading" },
          { state: { phase: "not-measured", why: "capacity-reading timed out" }, subject: "the ceiling reading" },
          { state: READY, subject: "the board reconcile" },
        ],
      }),
    ).toEqual({
      failed: [{ subject: "the ceiling reading", why: "capacity-reading timed out" }],
      loading: ["the machine capacity reading"],
    });
  });

  it("counts a stale reading as in hand", () => {
    expect(
      unreadReadingsOf({ readings: [{ state: { ...READY, stale: { why: "timed out" } }, subject: "the board" }] }),
    ).toEqual({ failed: [], loading: [] });
  });

  it("finds nothing unread among no readings", () => {
    expect(unreadReadingsOf({ readings: [] })).toEqual({ failed: [], loading: [] });
  });
});
