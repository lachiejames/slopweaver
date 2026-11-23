/*
 * A failed read keeps the reading already drawn, marked stale with the failure's reason (a two-hour stale queue stays visible, with a
 * staleness indicator beside it), and every count, badge and press judges by the latest read rather than by what is drawn.
 */
import { describe, expect, it } from "vitest";

import { answeredHere, type LiveState, latestReadOf, liveStateAfter } from "../../lib/liveState";

const READING: LiveState<readonly string[]> = {
  fixture: undefined,
  observedAtIso: "2026-10-10T14:40:00.000Z",
  phase: "ready",
  stampedByRoute: true,
  value: ["hand:a", "hand:b"],
};

const FAILED: LiveState<readonly string[]> = { phase: "not-measured", why: "hand list exited 1" };

describe("liveStateAfter", () => {
  it("keeps the reading drawn over a failed read, its age and value untouched, marked stale with the reason", () => {
    expect(liveStateAfter({ current: FAILED, previous: READING })).toStrictEqual({
      fixture: undefined,
      observedAtIso: "2026-10-10T14:40:00.000Z",
      phase: "ready",
      stale: { why: "hand list exited 1" },
      stampedByRoute: true,
      value: ["hand:a", "hand:b"],
    });
  });

  it("replaces the reason when a stale reading fails again, keeping the same reading", () => {
    const once = liveStateAfter({ current: FAILED, previous: READING });
    const twice = liveStateAfter({ current: { phase: "not-measured", why: "the route timed out" }, previous: once });
    expect(twice).toStrictEqual({ ...READING, stale: { why: "the route timed out" } });
  });

  it("drops a handover's refreshing mark when it keeps the reading, since nothing is replacing it any more", () => {
    const handedOver: LiveState<readonly string[]> = { ...READING, refreshing: true };
    expect(liveStateAfter({ current: FAILED, previous: handedOver })).toStrictEqual({
      ...READING,
      stale: { why: "hand list exited 1" },
    });
  });

  it("draws the failure when nothing had answered before it", () => {
    expect([
      liveStateAfter({ current: FAILED, previous: { phase: "loading" } }),
      liveStateAfter({ current: FAILED, previous: { phase: "not-measured", why: "earlier" } }),
    ]).toStrictEqual([FAILED, FAILED]);
  });

  it("draws a fresh reading in place of a stale one, clearing the mark", () => {
    const stale = liveStateAfter({ current: FAILED, previous: READING });
    const fresh: LiveState<readonly string[]> = { ...READING, observedAtIso: "2026-10-10T16:40:00.000Z", value: [] };
    expect(liveStateAfter({ current: fresh, previous: stale })).toStrictEqual(fresh);
  });

  it("draws loading in place of a reading, so a press never keeps a reading from before its write", () => {
    expect(liveStateAfter({ current: { phase: "loading" }, previous: READING })).toStrictEqual({ phase: "loading" });
  });
});

describe("latestReadOf", () => {
  it("calls a reading drawn over a failed read that failure, with its reason", () => {
    expect(latestReadOf({ state: liveStateAfter({ current: FAILED, previous: READING }) })).toStrictEqual({
      phase: "not-measured",
      why: "hand list exited 1",
    });
  });

  it("passes a current reading, a loading and a failure through as their own phase", () => {
    expect([
      latestReadOf({ state: READING }),
      latestReadOf({ state: { phase: "loading" } }),
      latestReadOf({ state: FAILED }),
    ]).toStrictEqual([{ phase: "ready" }, { phase: "loading" }, { phase: "not-measured", why: "hand list exited 1" }]);
  });
});

describe("answeredHere", () => {
  it("is true only of a reading this page's own read answered: never a handed-over one, a kept one, loading or failed", () => {
    const handedOver: LiveState<readonly string[]> = { ...READING, refreshing: true };
    const kept = liveStateAfter({ current: FAILED, previous: READING });
    expect([
      answeredHere({ state: READING }),
      answeredHere({ state: handedOver }),
      answeredHere({ state: kept }),
      answeredHere({ state: { phase: "loading" } }),
      answeredHere({ state: FAILED }),
    ]).toEqual([true, false, false, false, false]);
    expect(latestReadOf({ state: handedOver })).toStrictEqual({ phase: "ready" });
  });
});
