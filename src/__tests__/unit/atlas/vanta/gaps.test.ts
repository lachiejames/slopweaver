import { describe, expect, it } from "vitest";

import { openVantaGap, openVantaGaps, reconcileVantaGaps } from "../../../../atlas/vanta/gaps.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("openVantaGap", () => {
  it("stamps an open gap with matching first/last-detected times", () => {
    const gap = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "boom",
      scope: "controls-active",
    });
    expect(gap.status).toBe("open");
    expect(gap.firstDetectedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(gap.lastDetectedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("reconcileVantaGaps", () => {
  it("keeps firstDetectedAt across runs while advancing lastDetectedAt", () => {
    const first = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r1",
      scope: "s",
    });
    const secondObservation = openVantaGap({
      at: "2026-01-02T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r2",
      scope: "s",
    });
    const result = reconcileVantaGaps({
      at: "2026-01-02T00:00:00.000Z",
      observed: [secondObservation],
      rechecks: [],
      runFailed: false,
      stored: [first],
    });
    expect(result.isOk()).toBe(true);
    const [gap] = unwrap(result);
    expect(gap!.firstDetectedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(gap!.lastDetectedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(gap!.reason).toBe("r2");
  });

  it("closes a gap when its own condition+scope is rechecked and resolved", () => {
    const gap = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r1",
      scope: "s",
    });
    const result = reconcileVantaGaps({
      at: "2026-01-02T00:00:00.000Z",
      observed: [],
      rechecks: [{ condition: "schema-drift", resolved: true, scope: "s" }],
      runFailed: false,
      stored: [gap],
    });
    expect(unwrap(result)[0]!.status).toBe("closed");
  });

  it("never closes anything on a failed run, even with a matching recheck", () => {
    const gap = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r1",
      scope: "s",
    });
    const result = reconcileVantaGaps({
      at: "2026-01-02T00:00:00.000Z",
      observed: [],
      rechecks: [{ condition: "schema-drift", resolved: true, scope: "s" }],
      runFailed: true,
      stored: [gap],
    });
    expect(unwrap(result)[0]!.status).toBe("open");
  });

  it("refuses two observed gaps sharing one id", () => {
    const gap = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r1",
      scope: "s",
    });
    const result = reconcileVantaGaps({
      at: "2026-01-01T00:00:00.000Z",
      observed: [gap, gap],
      rechecks: [],
      runFailed: false,
      stored: [],
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("reported the same gap twice");
  });

  it("sorts the accumulated list by id", () => {
    const a = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r",
      scope: "aaa",
    });
    const b = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r",
      scope: "zzz",
    });
    const result = reconcileVantaGaps({
      at: "2026-01-01T00:00:00.000Z",
      observed: [b, a],
      rechecks: [],
      runFailed: false,
      stored: [],
    });
    const ids = unwrap(result).map((gap) => gap.id);
    expect(ids).toEqual(ids.toSorted());
  });
});

describe("openVantaGaps", () => {
  it("filters to only the open ones", () => {
    const open = openVantaGap({
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      condition: "schema-drift",
      kind: "control",
      reason: "r",
      scope: "open-one",
    });
    const closed = {
      ...openVantaGap({
        at: "2026-01-01T00:00:00.000Z",
        channel: "manage-api",
        condition: "schema-drift",
        kind: "control",
        reason: "r",
        scope: "closed-one",
      }),
      status: "closed" as const,
    };
    expect(openVantaGaps({ gaps: [open, closed] })).toEqual([open]);
  });
});
