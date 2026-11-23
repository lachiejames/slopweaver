/*
 * A by-id read's kept reading: a failed re-read of an id read before draws that reading marked stale, never the
 * failure alone, and never another id's reading.
 */

import { describe, expect, it } from "vitest";

import { KEPT_READINGS_MAX, keptOverFailure } from "../../lib/keptReading";

type Ready = { readonly phase: "ready"; readonly body: string };

const FAILED = { phase: "not-measured", why: "gmail read exited 1" } as const;

describe("keptOverFailure", () => {
  it("draws the earlier reading marked stale when a re-read of the same id fails", () => {
    const kept = new Map<string, Ready>();
    keptOverFailure({ id: "t1", kept, next: { body: "the thread", phase: "ready" } });
    expect(keptOverFailure({ id: "t1", kept, next: FAILED })).toEqual({
      body: "the thread",
      phase: "ready",
      stale: { why: "gmail read exited 1" },
    });
  });

  it("draws the failure when nothing was read for that id, whatever another id holds", () => {
    const kept = new Map<string, Ready>();
    keptOverFailure({ id: "t1", kept, next: { body: "the thread", phase: "ready" } });
    expect(keptOverFailure({ id: "t2", kept, next: FAILED })).toEqual(FAILED);
  });

  it("replaces the kept reading with a fresh one", () => {
    const kept = new Map<string, Ready>();
    keptOverFailure({ id: "t1", kept, next: { body: "old", phase: "ready" } });
    expect(keptOverFailure({ id: "t1", kept, next: { body: "new", phase: "ready" } })).toEqual({
      body: "new",
      phase: "ready",
    });
    expect(kept.get("t1")).toEqual({ body: "new", phase: "ready" });
  });

  it("drops the oldest reading past the bound", () => {
    const kept = new Map<string, Ready>();
    for (let at = 0; at <= KEPT_READINGS_MAX; at += 1) {
      keptOverFailure({ id: `t${String(at)}`, kept, next: { body: "b", phase: "ready" } });
    }
    expect([kept.size, kept.has("t0"), kept.has(`t${String(KEPT_READINGS_MAX)}`)]).toEqual([
      KEPT_READINGS_MAX,
      false,
      true,
    ]);
  });
});
