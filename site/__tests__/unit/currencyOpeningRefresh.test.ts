/*
 * Opening the Queue takes its own currency check once, when the one shown is missing, unreadable or ten minutes old —
 * aged from the document's own checkedIso — and never twice in one opening.
 */
import { describe, expect, it } from "vitest";

import type { Reading } from "../../components/live/reading";
import type { CurrencyReading } from "../../lib/cardCurrency";
import { CURRENCY_OPEN_FRESH_MINUTES, currencyOpeningRefreshPlan } from "../../lib/currencyOpeningRefresh";
import type { LiveState } from "../../lib/liveState";

const NOW = Date.parse("2026-11-03T10:00:00.000Z");

/** A recorded check, `checkedIso` as given, drawn ready — kept over a failed poll when `stale` is given. */
function ready({
  checkedIso,
  readingId,
  fixture,
  stale,
}: {
  checkedIso: string;
  readingId: string;
  fixture?: string;
  stale?: string;
}): LiveState<Reading<CurrencyReading>> {
  return {
    fixture,
    observedAtIso: checkedIso,
    phase: "ready",
    stampedByRoute: false,
    value: {
      by: "tick-614",
      observedAtIso: checkedIso,
      readingId,
      recordedAtIso: checkedIso,
      value: {
        checkedIso,
        readFromIso: "2026-11-02T10:00:00.000Z",
        rows: [],
        schemaVersion: 2,
        sources: { chair: "0 turns read", relays: "0 undelivered", voice: "0 unread call words" },
      },
    },
    ...(stale === undefined ? {} : { stale: { why: stale } }),
  };
}

describe("currencyOpeningRefreshPlan", () => {
  it("matches the route's automatic backoff", () => {
    expect(CURRENCY_OPEN_FRESH_MINUTES).toBe(10);
  });

  it("waits while the first reading is loading, so the opening is not spent before it arrives", () => {
    expect(currencyOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state: { phase: "loading" } })).toEqual({
      kind: "wait",
    });
  });

  it("skips a frozen fixture", () => {
    const state = ready({ checkedIso: "2026-11-01T00:00:00.000Z", fixture: "queue", readingId: "r1" });
    expect(currencyOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state })).toEqual({
      kind: "skip",
      why: "fixture",
    });
  });

  it("asks over none when there is no reading it can show", () => {
    const state: LiveState<Reading<CurrencyReading>> = {
      phase: "not-measured",
      why: "no reading of handover currency yet",
    };
    expect(currencyOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state })).toEqual({
      forReading: "none",
      kind: "ask",
    });
  });

  it("asks over a fresh reading kept over a failed poll, since the latest read did not answer", () => {
    const state = ready({
      checkedIso: "2026-11-03T09:59:00.000Z",
      readingId: "r1",
      stale: "the ledger read timed out",
    });
    expect(currencyOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state })).toEqual({
      forReading: "r1",
      kind: "ask",
    });
  });

  it("keeps a check 9:59.999 old and asks over one exactly ten minutes old", () => {
    const young = ready({ checkedIso: "2026-11-03T09:50:00.001Z", readingId: "r1" });
    const due = ready({ checkedIso: "2026-11-03T09:50:00.000Z", readingId: "r1" });
    expect(currencyOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state: young })).toEqual({
      kind: "skip",
      why: "fresh",
    });
    expect(currencyOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state: due })).toEqual({
      forReading: "r1",
      kind: "ask",
    });
  });

  it("asks when the check's instant will not parse, never calling it fresh", () => {
    const state = ready({ checkedIso: "not a date", readingId: "r1" });
    expect(currencyOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state })).toEqual({
      forReading: "r1",
      kind: "ask",
    });
  });

  it("skips a reading this page already asked over inside the route's backoff", () => {
    const state = ready({ checkedIso: "2026-11-03T09:00:00.000Z", readingId: "r1" });
    expect(currencyOpeningRefreshPlan({ asked: { r1: NOW - 60_000 }, nowMs: NOW, settled: false, state })).toEqual({
      kind: "skip",
      why: "already-asked",
    });
  });

  it("never asks again once the opening is settled, even over a new reading that is already due", () => {
    // The opening asked over r1; the run recorded r2, which a later poll brings — and a tick's reading after it.
    const asked = { r1: NOW - 120_000 };
    const r2 = ready({ checkedIso: "2026-11-03T09:40:00.000Z", readingId: "r2" });
    expect(currencyOpeningRefreshPlan({ asked, nowMs: NOW, settled: false, state: r2 })).toEqual({
      forReading: "r2",
      kind: "ask",
    });
    expect(currencyOpeningRefreshPlan({ asked, nowMs: NOW, settled: true, state: r2 })).toEqual({
      kind: "skip",
      why: "settled",
    });
  });
});
