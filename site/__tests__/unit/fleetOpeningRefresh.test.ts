/*
 * Opening the Fleet page takes its own session watch and fleet burn readings once each, when the one shown is
 * missing, not recorded or ten minutes old — aged from the ledger reading's own observedAtIso.
 */
import { describe, expect, it } from "vitest";

import type { Reading, RecordedReading } from "../../components/live/reading";
import type { Seats } from "../../components/live/readNow";
import { burnOpeningRefreshPlan, seatsOpeningRefreshPlan } from "../../lib/fleetOpeningRefresh";
import type { LiveState } from "../../lib/liveState";
import type { FleetBurn } from "../../lib/planMeters";

const NOW = Date.parse("2026-11-20T08:00:00.000Z");

/** A recorded value drawn ready, read at `observedAtIso`. */
function readyOf<T>({ observedAtIso, readingId, value }: { observedAtIso: string; readingId: string; value: T }): {
  phase: "ready";
  observedAtIso: string;
  stampedByRoute: false;
  fixture: undefined;
  value: Reading<T>;
} {
  return {
    fixture: undefined,
    observedAtIso,
    phase: "ready",
    stampedByRoute: false,
    value: { by: "sync-now", observedAtIso, readingId, recordedAtIso: observedAtIso, value },
  };
}

const SEATS: Seats = {
  diagnostics: [],
  observedAtIso: "2026-11-20T07:55:00.000Z",
  rows: [],
  suppressed: 0,
  suppressedOldestQuietMinutes: undefined,
};

const BURN: FleetBurn = {
  activeWithinMinutes: 10,
  claude: { kind: "unavailable", why: "no transcripts" },
  codex: { kind: "unavailable", why: "no rollouts" },
  windowHours: 5,
};

describe("seatsOpeningRefreshPlan", () => {
  it("keeps a seat reading observed under ten minutes ago", () => {
    const state: LiveState<RecordedReading<Seats>> = readyOf({
      observedAtIso: "2026-11-20T07:50:00.001Z",
      readingId: "w1",
      value: SEATS,
    });
    expect(seatsOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state })).toEqual({
      kind: "skip",
      why: "fresh",
    });
  });

  it("asks over a seat reading observed weeks ago — the stale 'working now' the page drew", () => {
    const state: LiveState<RecordedReading<Seats>> = readyOf({
      observedAtIso: "2026-10-28T08:00:00.000Z",
      readingId: "w-old",
      value: SEATS,
    });
    expect(seatsOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state })).toEqual({
      forReading: "w-old",
      kind: "ask",
    });
  });

  it("asks over none when the ledger holds no session watch reading yet", () => {
    const state: LiveState<RecordedReading<Seats>> = {
      fixture: undefined,
      observedAtIso: "2026-11-20T08:00:00.000Z",
      phase: "ready",
      stampedByRoute: true,
      value: { kind: "not-recorded", why: "no reading of session watch yet" },
    };
    expect(seatsOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state })).toEqual({
      forReading: "none",
      kind: "ask",
    });
  });
});

describe("burnOpeningRefreshPlan", () => {
  it("asks over a burn reading exactly ten minutes old, and keeps one a millisecond younger", () => {
    const old = readyOf({ observedAtIso: "2026-11-20T07:50:00.000Z", readingId: "b1", value: BURN });
    const young = readyOf({ observedAtIso: "2026-11-20T07:50:00.001Z", readingId: "b2", value: BURN });
    expect([
      burnOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state: old }),
      burnOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: false, state: young }),
    ]).toEqual([
      { forReading: "b1", kind: "ask" },
      { kind: "skip", why: "fresh" },
    ]);
  });

  it("never asks twice in one opening", () => {
    const state = readyOf({ observedAtIso: "2026-11-01T00:00:00.000Z", readingId: "b1", value: BURN });
    expect(burnOpeningRefreshPlan({ asked: {}, nowMs: NOW, settled: true, state })).toEqual({
      kind: "skip",
      why: "settled",
    });
  });
});
