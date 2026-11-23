/** The action a designed empty state draws: Settings → Models only while no plan is known connected, a connect step always. */
import { describe, expect, it } from "vitest";

import { integrationOf } from "../../lib/integrations";
import type { LiveState } from "../../lib/liveState";
import {
  emptyDrawOf,
  emptyProvenOf,
  noPlanConnectedOf,
  overlaysReadOf,
  pageEmptyActionOf,
  provenNowOf,
} from "../../lib/pageEmpty";

const AT = "2026-11-04T00:00:00.000Z";
const READY: LiveState<readonly string[]> = {
  fixture: undefined,
  observedAtIso: AT,
  phase: "ready",
  stampedByRoute: true,
  value: [],
};

describe("provenNowOf", () => {
  it("proves an empty page only off a ready reading whose latest read answered", () => {
    expect(provenNowOf({ state: READY })).toBe(true);
  });

  it("proves nothing off a value kept over a failed read, handed over mid-read, loading or failed", () => {
    expect([
      provenNowOf({ state: { ...READY, stale: { why: "exit 1" } } }),
      provenNowOf({ state: { ...READY, refreshing: true } }),
      provenNowOf({ state: { phase: "loading" } }),
      provenNowOf({ state: { phase: "not-measured", why: "timed out" } }),
    ]).toEqual([false, false, false, false]);
  });
});

describe("emptyProvenOf", () => {
  const HOLDING: LiveState<readonly string[]> = { ...READY, value: ["act-1"] };
  const STALE: LiveState<unknown> = { ...READY, stale: { why: "exit 1" } };

  it("proves an empty source empty whatever its overlays say, since no overlay adds a row", () => {
    expect(emptyProvenOf({ overlays: [STALE, { phase: "loading" }], source: READY })).toBe(true);
  });

  it("proves rows every overlay hid empty only while every overlay is current", () => {
    expect([
      emptyProvenOf({ overlays: [READY, READY], source: HOLDING }),
      emptyProvenOf({ overlays: [READY, STALE], source: HOLDING }),
      emptyProvenOf({ overlays: [{ ...READY, refreshing: true }], source: HOLDING }),
      emptyProvenOf({ overlays: [{ phase: "not-measured", why: "exit 3" }], source: HOLDING }),
    ]).toEqual([true, false, false, false]);
  });

  it("proves nothing off a source that is not current itself", () => {
    expect([
      emptyProvenOf({ overlays: [], source: { ...READY, stale: { why: "exit 1" } } }),
      emptyProvenOf({ overlays: [], source: { phase: "loading" } }),
    ]).toEqual([false, false]);
  });
});

describe("emptyDrawOf", () => {
  it("draws the designed empty state only for a list proven empty now", () => {
    expect(emptyDrawOf({ empty: true, inHand: true, proven: true })).toBe("designed");
  });

  it("draws a plain line, never blank, for a list emptied by a kept reading", () => {
    expect(emptyDrawOf({ empty: true, inHand: true, proven: false })).toBe("plain");
  });

  it("draws nothing for a list holding rows, or one whose first read has not arrived", () => {
    expect([
      emptyDrawOf({ empty: false, inHand: true, proven: true }),
      emptyDrawOf({ empty: true, inHand: false, proven: false }),
    ]).toEqual(["none", "none"]);
  });
});

describe("overlaysReadOf", () => {
  const REFRESHING: LiveState<unknown> = { ...READY, refreshing: true };

  it("is a first read, not in hand, while any overlay is still being read for the first time", () => {
    expect(overlaysReadOf({ overlays: [READY, REFRESHING, { phase: "loading" }] })).toEqual({
      activity: "first-read",
      inHand: false,
    });
  });

  it("is a re-read, in hand, while every overlay delivered and one is a handed-over reading being replaced", () => {
    expect(overlaysReadOf({ overlays: [READY, REFRESHING, READY] })).toEqual({ activity: "re-reading", inHand: true });
  });

  it("is settled and in hand once every overlay delivered, a failed read kept over included", () => {
    expect([
      overlaysReadOf({ overlays: [READY, READY] }),
      overlaysReadOf({ overlays: [READY, { ...READY, stale: { why: "exit 1" } }] }),
    ]).toEqual([
      { activity: "settled", inHand: true },
      { activity: "settled", inHand: true },
    ]);
  });

  it("is settled but NOT in hand when an overlay delivered nothing at all, even beside a re-read", () => {
    expect([
      overlaysReadOf({ overlays: [READY, { phase: "not-measured", why: "exit 3" }] }),
      overlaysReadOf({ overlays: [REFRESHING, { phase: "not-measured", why: "exit 3" }] }),
    ]).toEqual([
      { activity: "settled", inHand: false },
      { activity: "re-reading", inHand: false },
    ]);
  });

  it("is settled and in hand over no overlays at all", () => {
    expect(overlaysReadOf({ overlays: [] })).toEqual({ activity: "settled", inHand: true });
  });

  it("leaves a re-reading section's empty list the plain line, never the designed state", () => {
    const { inHand } = overlaysReadOf({ overlays: [REFRESHING] });
    const proven = emptyProvenOf({ overlays: [REFRESHING], source: { ...READY, value: ["act-1"] } });
    expect(emptyDrawOf({ empty: true, inHand, proven })).toBe("plain");
  });

  it("draws nothing for an empty list whose overlay delivered nothing, never a 'last reading' line", () => {
    const failed: LiveState<unknown> = { phase: "not-measured", why: "exit 3" };
    const { inHand } = overlaysReadOf({ overlays: [failed] });
    const proven = emptyProvenOf({ overlays: [failed], source: { ...READY, value: ["act-1"] } });
    expect(emptyDrawOf({ empty: true, inHand, proven })).toBe("none");
  });
});

describe("noPlanConnectedOf", () => {
  const NONE: LiveState<{ readonly plans: readonly unknown[] }> = { ...READY, value: { plans: [] } };

  it("answers true for a current reading holding no plan, false for one holding a plan", () => {
    expect([
      noPlanConnectedOf({ plans: NONE }),
      noPlanConnectedOf({ plans: { ...NONE, value: { plans: [{ alias: "codex-1" }] } } }),
    ]).toEqual([true, false]);
  });

  it("cannot tell off a reading kept over a failed read, mid-read, loading or failed", () => {
    expect([
      noPlanConnectedOf({ plans: { ...NONE, stale: { why: "exit 1" } } }),
      noPlanConnectedOf({ plans: { ...NONE, refreshing: true } }),
      noPlanConnectedOf({ plans: { phase: "loading" } }),
      noPlanConnectedOf({ plans: { phase: "not-measured", why: "timed out" } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("pageEmptyActionOf", () => {
  it("offers Settings → Models while no plan is known connected", () => {
    expect(pageEmptyActionOf({ noPlanConnected: true, requested: { kind: "plans" } })).toEqual({ kind: "plans" });
  });

  it("offers nothing once a plan is connected", () => {
    expect(pageEmptyActionOf({ noPlanConnected: false, requested: { kind: "plans" } })).toEqual({ kind: "none" });
  });

  it("offers nothing when the plans reading cannot tell, never a claim that no plan is connected", () => {
    expect(pageEmptyActionOf({ noPlanConnected: undefined, requested: { kind: "plans" } })).toEqual({ kind: "none" });
  });

  it("keeps a connect step whatever the plans say, naming the integration and what it would read", () => {
    const calendar = integrationOf({ id: "calendar" });
    const requested = { integration: calendar, kind: "connect", subjects: ["the morning briefing"] } as const;
    expect(pageEmptyActionOf({ noPlanConnected: undefined, requested })).toEqual({
      integration: calendar,
      kind: "connect",
      subjects: ["the morning briefing"],
    });
    expect(pageEmptyActionOf({ noPlanConnected: true, requested })).toEqual({
      integration: calendar,
      kind: "connect",
      subjects: ["the morning briefing"],
    });
  });

  it("offers nothing when the page asked for nothing, even with no plan connected", () => {
    expect(pageEmptyActionOf({ noPlanConnected: true, requested: { kind: "none" } })).toEqual({ kind: "none" });
  });
});
