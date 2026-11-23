/*
 * The one line beside the pull-request page's selector : a failed sync says it failed to sync, the
 * reason one hover away, and the age of what is on screen otherwise. A read in flight is a spinner and a failed one a
 * staleness mark, never words in their place.
 */
import { describe, expect, it } from "vitest";

import { type PrReadingState, prFreshnessLine } from "../../lib/prFreshness";

const NOW_MS = Date.parse("2026-10-08T09:00:00.000Z");
/** The page's own age words, reduced to the instant so each case names exactly which one it aged. */
const age = (iso: string): string => `at ${iso}`;

const READY = (minutesOld: number): PrReadingState => ({
  by: "supervisor tick",
  fixture: false,
  observedAtIso: new Date(NOW_MS - minutesOld * 60_000).toISOString(),
  phase: "ready",
});

describe("prFreshnessLine", () => {
  it("is quiet with the reading's age while it is inside the landing cadence", () => {
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading: READY(10), sync: { phase: "idle" } })).toStrictEqual({
      kind: "text",
      title: "taken by supervisor tick at 2026-10-08T08:50:00.000Z",
      tone: "quiet",
      words: "updated at 2026-10-08T08:50:00.000Z",
    });
  });

  it("warns, still showing every card's age, once the reading is past the cadence", () => {
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading: READY(45), sync: { phase: "idle" } })).toStrictEqual({
      kind: "text",
      title: "older than the 30-minute landing cadence (taken by supervisor tick)",
      tone: "warn",
      words: "updated at 2026-10-08T08:15:00.000Z",
    });
  });

  it("marks a failed sync stale beside the age of what is shown, the reason in the mark", () => {
    const sync = { atIso: "2026-10-08T08:58:00.000Z", auto: "due", phase: "failed", why: "gh exited 1" } as const;
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading: READY(45), sync })).toStrictEqual({
      facts: [
        {
          observedAtIso: "2026-10-08T08:15:00.000Z",
          subject: "A fresh landing reading",
          why: "gh exited 1 (at 2026-10-08T08:58:00.000Z)",
        },
      ],
      kind: "stale",
      words: "updated at 2026-10-08T08:15:00.000Z",
    });
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading: { phase: "loading" }, sync })).toStrictEqual({
      facts: [{ subject: "A fresh landing reading", why: "gh exited 1 (at 2026-10-08T08:58:00.000Z)" }],
      kind: "stale",
      words: "",
    });
  });

  it("draws a spinner while the page takes a fresh reading by itself, the shown cards' age beside it, why on hover", () => {
    const sync = { auto: "no-census", phase: "taking", startedAtIso: "2026-10-08T08:59:00.000Z" } as const;
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading: READY(10), sync })).toStrictEqual({
      kind: "reading",
      label:
        "Taking a fresh github landing reading, started at 2026-10-08T08:59:00.000Z, because the reading shown " +
        "predates GitHub's own open count",
      words: "updated at 2026-10-08T08:50:00.000Z",
    });
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading: { phase: "loading" }, sync }).words).toBe("");
  });

  it("says FIXTURE over everything else, since nothing on a fixture is live", () => {
    const reading: PrReadingState = {
      by: "a fixture",
      fixture: true,
      observedAtIso: "2026-10-08T08:15:00.000Z",
      phase: "ready",
    };
    const sync = { atIso: "2026-10-08T08:58:00.000Z", auto: undefined, phase: "failed", why: "x" } as const;
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading, sync }).words).toBe(
      "FIXTURE · read at 2026-10-08T08:15:00.000Z",
    );
  });

  it("draws a spinner while the ledger is read, and a staleness mark with the reason when there is no reading", () => {
    expect(
      prFreshnessLine({ age, nowMs: NOW_MS, reading: { phase: "loading" }, sync: { phase: "idle" } }),
    ).toStrictEqual({ kind: "reading", label: "Reading the landing ledger", words: "" });
    expect(
      prFreshnessLine({
        age,
        nowMs: NOW_MS,
        reading: { phase: "not-measured", why: "no reading recorded" },
        sync: { phase: "idle" },
      }),
    ).toStrictEqual({
      facts: [{ subject: "The landing ledger", why: "no reading recorded" }],
      kind: "stale",
      words: "",
    });
  });

  it("marks a reading drawn over a failed read of the ledger stale, keeping its age beside the mark", () => {
    const reading: PrReadingState = {
      by: "supervisor tick",
      fixture: false,
      observedAtIso: "2026-10-08T08:50:00.000Z",
      phase: "ready",
      stale: "the ledger read timed out",
    };
    expect(prFreshnessLine({ age, nowMs: NOW_MS, reading, sync: { phase: "idle" } })).toStrictEqual({
      facts: [
        { observedAtIso: "2026-10-08T08:50:00.000Z", subject: "The landing ledger", why: "the ledger read timed out" },
      ],
      kind: "stale",
      words: "updated at 2026-10-08T08:50:00.000Z",
    });
  });
});
