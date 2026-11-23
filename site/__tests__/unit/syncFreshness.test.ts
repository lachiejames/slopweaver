/*
 * Every page-owned reading shares one rate limit: the sync route runs one automatic attempt per reading per backoff
 * however often it is asked, forgets an attempt once its backoff has passed, and a page never re-asks over the
 * reading still on screen after its own run returned.
 */
import { describe, expect, it } from "vitest";

import {
  autoAttemptRefusedUntil,
  MAX_TRIED_ENTRIES,
  NO_READING_ID,
  nextPageAskAtOf,
  pageMayAsk,
  SYNC_NOW_BY,
} from "../../lib/syncFreshness";

const NOW = Date.parse("2026-09-26T13:30:00.000Z");

describe("the shared names", () => {
  it("records a page's own reading as sync-now and names an absent one none", () => {
    expect(SYNC_NOW_BY).toBe("sync-now");
    expect(NO_READING_ID).toBe("none");
  });
});

describe("autoAttemptRefusedUntil", () => {
  it("runs the first automatic attempt over a reading and refuses every later one inside the backoff", () => {
    const tried = new Map<string, number>();
    expect(autoAttemptRefusedUntil({ nowMs: NOW, readingId: "r1", slug: "landing", tried })).toBe(undefined);
    // A remount, a reload or a second tab one minute later: refused, naming when the next may run.
    expect(autoAttemptRefusedUntil({ nowMs: NOW + 60_000, readingId: "r1", slug: "landing", tried })).toBe(
      NOW + 600_000,
    );
    expect(autoAttemptRefusedUntil({ nowMs: NOW + 599_999, readingId: "r1", slug: "landing", tried })).toBe(
      NOW + 600_000,
    );
  });

  it("runs again once the backoff has passed, so a failed run is retried rather than stranded", () => {
    const tried = new Map<string, number>([["landing r1", NOW]]);
    expect(autoAttemptRefusedUntil({ nowMs: NOW + 600_000, readingId: "r1", slug: "landing", tried })).toBe(undefined);
    expect(tried.get("landing r1")).toBe(NOW + 600_000);
  });

  it("keeps each reading and each verb apart", () => {
    const tried = new Map<string, number>([["landing r1", NOW]]);
    expect(autoAttemptRefusedUntil({ nowMs: NOW, readingId: "r2", slug: "landing", tried })).toBe(undefined);
    expect(autoAttemptRefusedUntil({ nowMs: NOW, readingId: "r1", slug: "currency", tried })).toBe(undefined);
    expect([...tried.keys()]).toStrictEqual(["landing r1", "landing r2", "currency r1"]);
  });

  it("deletes every entry whose backoff has passed, and keeps one still inside it", () => {
    const tried = new Map<string, number>([
      ["landing r1", NOW - 600_000],
      ["currency r7", NOW - 600_001],
      ["currency r8", NOW - 599_999],
    ]);
    expect(autoAttemptRefusedUntil({ nowMs: NOW, readingId: "r9", slug: "currency", tried })).toBe(undefined);
    expect([...tried.entries()]).toStrictEqual([
      ["currency r8", NOW - 599_999],
      ["currency r9", NOW],
    ]);
  });

  it("holds at most MAX_TRIED_ENTRIES inside one backoff window, dropping the oldest attempt first", () => {
    // The reading id is request input, so distinct ids inside the window grew the map.
    const tried = new Map<string, number>(
      Array.from({ length: MAX_TRIED_ENTRIES }, (_, index) => [`currency r${String(index)}`, NOW - 1000 + index]),
    );
    expect(autoAttemptRefusedUntil({ nowMs: NOW, readingId: "fresh", slug: "currency", tried })).toBe(undefined);
    expect(tried.size).toBe(MAX_TRIED_ENTRIES);
    expect(tried.has("currency r0")).toBe(false);
    expect(tried.get("currency r1")).toBe(NOW - 999);
    expect(tried.get("currency fresh")).toBe(NOW);
  });
});

describe("pageMayAsk", () => {
  it("asks over a reading it has not taken a run over", () => {
    expect(pageMayAsk({ asked: {}, nowMs: NOW, readingId: "r1" })).toBe(true);
    expect(pageMayAsk({ asked: { r0: NOW }, nowMs: NOW, readingId: "r1" })).toBe(true);
  });

  it("never asks again over the old reading still on screen after a run returns, until the route would allow it", () => {
    const asked = { r1: NOW };
    // A press or an automatic run returned 150s in; the ledger re-read has not replaced r1 yet.
    expect(pageMayAsk({ asked, nowMs: NOW + 150_000, readingId: "r1" })).toBe(false);
    // The route's ten-minute backoff plus a minute of request latency, so the retry is not refused.
    expect(pageMayAsk({ asked, nowMs: NOW + 659_999, readingId: "r1" })).toBe(false);
    expect(pageMayAsk({ asked, nowMs: NOW + 660_000, readingId: "r1" })).toBe(true);
  });

  it("still refuses a reading asked over before a request over another one came between", () => {
    // Asked over r1, then the reading could not be read and the page asked over none; r1 came back on screen.
    const asked = { none: NOW + 60_000, r1: NOW };
    expect(pageMayAsk({ asked, nowMs: NOW + 120_000, readingId: "r1" })).toBe(false);
  });
});

describe("nextPageAskAtOf", () => {
  it("is eleven minutes after the ask over that reading, the instant pageMayAsk opens, and nothing when never asked", () => {
    const asked = { r1: NOW };
    const at = nextPageAskAtOf({ asked, readingId: "r1" })!;
    expect([at, nextPageAskAtOf({ asked, readingId: "r2" })]).toStrictEqual([NOW + 660_000, undefined]);
    expect([
      pageMayAsk({ asked, nowMs: at - 1, readingId: "r1" }),
      pageMayAsk({ asked, nowMs: at, readingId: "r1" }),
    ]).toStrictEqual([false, true]);
  });
});
