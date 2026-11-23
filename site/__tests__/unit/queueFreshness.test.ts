/*
 * The queue's freshness mark and its counted/apart split — the two properties the owner met missing
 * (a badge of 4 against a list of 13; week-old rows with no mark). A wording or threshold regression here is
 * invisible to `next build`, so this file is the ratchet.
 */

import { describe, expect, it } from "vitest";

import { rowFreshness, STALE_AFTER_HOURS } from "../../lib/queueFreshness";

const NOW_MS = Date.parse("2026-09-23T02:00:00Z");

describe("rowFreshness", () => {
  it("is fresh inside the threshold and carries the confirming instant", () => {
    const fresh = rowFreshness({
      madeIso: "2026-09-16T00:00:00Z",
      nowMs: NOW_MS,
      verifiedIso: "2026-09-23T01:00:00Z",
    });
    expect(fresh).toEqual({ hoursOld: 1, stale: false, verifiedIso: "2026-09-23T01:00:00Z" });
  });

  it("marks a row confirmed 35 hours ago stale", () => {
    const fresh = rowFreshness({ madeIso: undefined, nowMs: NOW_MS, verifiedIso: "2026-09-21T15:00:00Z" });
    expect(fresh.stale).toBe(true);
    expect(fresh.hoursOld).toBe(35);
  });

  it("goes stale exactly at the threshold", () => {
    const at = new Date(NOW_MS - STALE_AFTER_HOURS * 3_600_000).toISOString();
    expect(rowFreshness({ madeIso: undefined, nowMs: NOW_MS, verifiedIso: at }).stale).toBe(true);
  });

  it("ages a never re-confirmed row from when it was made, without inventing a verified instant", () => {
    const fresh = rowFreshness({ madeIso: "2026-09-15T18:48:00Z", nowMs: NOW_MS, verifiedIso: undefined });
    expect(fresh.verifiedIso).toBe(undefined);
    expect(fresh.stale).toBe(true);
    expect(fresh.hoursOld).toBeCloseTo(175.2, 5);
  });

  it("treats a never re-confirmed row made an hour ago as fresh", () => {
    const fresh = rowFreshness({ madeIso: "2026-09-23T01:00:00Z", nowMs: NOW_MS, verifiedIso: undefined });
    expect(fresh).toEqual({ hoursOld: 1, stale: false, verifiedIso: undefined });
  });

  it("marks a row with no instant at all stale", () => {
    expect(rowFreshness({ madeIso: undefined, nowMs: NOW_MS, verifiedIso: undefined })).toEqual({
      hoursOld: undefined,
      stale: true,
      verifiedIso: undefined,
    });
  });

  it("marks a row whose instant will not parse stale", () => {
    expect(rowFreshness({ madeIso: undefined, nowMs: NOW_MS, verifiedIso: "not a date" })).toEqual({
      hoursOld: undefined,
      stale: true,
      verifiedIso: "not a date",
    });
  });
});
