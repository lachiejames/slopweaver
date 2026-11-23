/*
 * The Alignment count's failure recovery, so a failed reading is read again rather than shown as an error until a
 * reload: which read-once reading the console reads again, when, and what the count says it is doing. The runner's
 * timer and `refreshLive` call are the hook's; every decision is this pure step.
 */
import { describe, expect, it } from "vitest";

import {
  type AlignmentSourceRead,
  alignmentRecoveryAsSeenOf,
  alignmentRecoveryStepOf,
  alignmentRecoveryWordsOf,
  alignmentRetryDelayMs,
} from "../../lib/alignmentAutoRefresh";

const T0 = Date.parse("2026-11-11T02:00:00.000Z");
const MINUTE = 60_000;

/** Two distinct failed readings, so a re-read's own answer is told from the failure it was asked over. */
const FIRST_FAILURE = { why: "exit 1" };
const SECOND_FAILURE = { why: "exit 1" };

const failed = ({ token }: { token: unknown }): AlignmentSourceRead => ({ phase: "failed", slug: "autonomy", token });

describe("alignmentRetryDelayMs", () => {
  it("doubles from a minute to a ten-minute cap", () => {
    expect([0, 1, 2, 3, 4, 9].map((attempt) => alignmentRetryDelayMs({ attempt }))).toEqual([
      MINUTE,
      2 * MINUTE,
      4 * MINUTE,
      8 * MINUTE,
      10 * MINUTE,
      10 * MINUTE,
    ]);
  });
});

describe("alignmentRecoveryStepOf", () => {
  it("schedules a first failure a minute out, never an immediate re-read a failing verb would loop on", () => {
    expect(
      alignmentRecoveryStepOf({ nowMs: T0, reads: [failed({ token: FIRST_FAILURE })], records: {}, visible: true }),
    ).toEqual({
      due: [],
      recovery: { atMs: T0 + MINUTE, phase: "waiting", visible: true },
      records: { autonomy: { attempt: 0, dueAtMs: T0 + MINUTE } },
      wakeAtMs: T0 + MINUTE,
    });
  });

  it("reads a due source again while the window is in view, and reports it as being read", () => {
    expect(
      alignmentRecoveryStepOf({
        nowMs: T0 + MINUTE,
        reads: [failed({ token: FIRST_FAILURE })],
        records: { autonomy: { attempt: 0, dueAtMs: T0 + MINUTE } },
        visible: true,
      }),
    ).toEqual({
      due: ["autonomy"],
      recovery: { phase: "reading" },
      records: { autonomy: { askedOver: FIRST_FAILURE, attempt: 0, dueAtMs: T0 + MINUTE } },
      wakeAtMs: undefined,
    });
  });

  it("asks nothing while the window is hidden, however overdue", () => {
    expect(
      alignmentRecoveryStepOf({
        nowMs: T0 + 30 * MINUTE,
        reads: [failed({ token: FIRST_FAILURE })],
        records: { autonomy: { attempt: 0, dueAtMs: T0 + MINUTE } },
        visible: false,
      }),
    ).toEqual({
      due: [],
      recovery: { atMs: T0 + MINUTE, phase: "waiting", visible: false },
      records: { autonomy: { attempt: 0, dueAtMs: T0 + MINUTE } },
      wakeAtMs: T0 + MINUTE,
    });
  });

  it("holds the record while the re-read is on its way, and asks it only once", () => {
    const asked = { autonomy: { askedOver: FIRST_FAILURE, attempt: 0, dueAtMs: T0 + MINUTE } };
    expect([
      alignmentRecoveryStepOf({
        nowMs: T0 + 2 * MINUTE,
        reads: [{ phase: "loading", slug: "autonomy", token: { phase: "loading" } }],
        records: asked,
        visible: true,
      }),
      alignmentRecoveryStepOf({
        nowMs: T0 + 2 * MINUTE,
        reads: [failed({ token: FIRST_FAILURE })],
        records: asked,
        visible: true,
      }),
    ]).toEqual([
      { due: [], recovery: { phase: "reading" }, records: asked, wakeAtMs: undefined },
      { due: [], recovery: { phase: "reading" }, records: asked, wakeAtMs: undefined },
    ]);
  });

  it("steps one along the backoff when the re-read answers and fails again", () => {
    expect(
      alignmentRecoveryStepOf({
        nowMs: T0 + 2 * MINUTE,
        reads: [failed({ token: SECOND_FAILURE })],
        records: { autonomy: { askedOver: FIRST_FAILURE, attempt: 0, dueAtMs: T0 + MINUTE } },
        visible: true,
      }),
    ).toEqual({
      due: [],
      recovery: { atMs: T0 + 4 * MINUTE, phase: "waiting", visible: true },
      records: { autonomy: { attempt: 1, dueAtMs: T0 + 4 * MINUTE } },
      wakeAtMs: T0 + 4 * MINUTE,
    });
  });

  it("drops a source the moment it reads current, and is idle with nothing left to recover", () => {
    expect(
      alignmentRecoveryStepOf({
        nowMs: T0 + 2 * MINUTE,
        reads: [{ phase: "current", slug: "autonomy", token: { phase: "ready" } }],
        records: { autonomy: { askedOver: FIRST_FAILURE, attempt: 3, dueAtMs: T0 } },
        visible: true,
      }),
    ).toEqual({ due: [], recovery: { phase: "idle" }, records: {}, wakeAtMs: undefined });
  });

  it("wakes at the earliest of several sources' due instants", () => {
    expect(
      alignmentRecoveryStepOf({
        nowMs: T0,
        reads: [
          failed({ token: FIRST_FAILURE }),
          { phase: "failed", slug: "alignment-answers", token: SECOND_FAILURE },
        ],
        records: { "alignment-answers": { attempt: 2, dueAtMs: T0 + 4 * MINUTE } },
        visible: true,
      }).wakeAtMs,
    ).toBe(T0 + MINUTE);
  });
});

describe("alignmentRecoveryWordsOf", () => {
  const clock = (atMs: number): string => `at ${new Date(atMs).toISOString()}`;

  it("says what the console is doing off the runner's own state, never a promise an age implies", () => {
    expect([
      alignmentRecoveryWordsOf({ clock, nowMs: T0, recovery: { phase: "reading" } }),
      alignmentRecoveryWordsOf({ clock, nowMs: T0, recovery: { phase: "idle" } }),
      alignmentRecoveryWordsOf({ clock, nowMs: T0, recovery: { atMs: T0 + MINUTE, phase: "waiting", visible: true } }),
      alignmentRecoveryWordsOf({ clock, nowMs: T0, recovery: { atMs: T0 - MINUTE, phase: "waiting", visible: false } }),
      alignmentRecoveryWordsOf({ clock, nowMs: T0, recovery: { atMs: T0 + MINUTE, phase: "waiting", visible: false } }),
    ]).toEqual([
      "The console is reading it again now",
      "The console reads it again on its next poll, within a minute while this window is in view",
      "The console tries again at 2026-11-11T02:01:00.000Z",
      "The console tries again once this window is in view",
      "The console tries again once this window is in view, not before at 2026-11-11T02:01:00.000Z",
    ]);
  });
});

describe("alignmentRecoveryAsSeenOf", () => {
  const clock = (atMs: number): string => `at ${new Date(atMs).toISOString()}`;

  it("words a step taken in view, read after the window is hidden, as waiting for the window — never a retry time the runner will skip", () => {
    const takenInView = { atMs: T0 + MINUTE, phase: "waiting", visible: true } as const;
    const seen = alignmentRecoveryAsSeenOf({ recovery: takenInView, visible: false });
    expect(seen).toEqual({ atMs: T0 + MINUTE, phase: "waiting", visible: false });
    expect([
      alignmentRecoveryWordsOf({ clock, nowMs: T0 + 30_000, recovery: seen }),
      alignmentRecoveryWordsOf({ clock, nowMs: T0 + 2 * MINUTE, recovery: seen }),
    ]).toEqual([
      "The console tries again once this window is in view, not before at 2026-11-11T02:01:00.000Z",
      "The console tries again once this window is in view",
    ]);
  });

  it("hands back the very same step whenever nothing differs, so a consumer keyed on its identity sees no change", () => {
    const waitingInView = { atMs: T0 + MINUTE, phase: "waiting", visible: true } as const;
    const reading = { phase: "reading" } as const;
    const idle = { phase: "idle" } as const;
    expect(alignmentRecoveryAsSeenOf({ recovery: waitingInView, visible: true })).toBe(waitingInView);
    expect(alignmentRecoveryAsSeenOf({ recovery: reading, visible: false })).toBe(reading);
    expect(alignmentRecoveryAsSeenOf({ recovery: idle, visible: false })).toBe(idle);
  });

  it("words a step taken hidden, read once the window is back in view, with its retry time", () => {
    const takenHidden = { atMs: T0 + MINUTE, phase: "waiting", visible: false } as const;
    expect(
      alignmentRecoveryWordsOf({
        clock,
        nowMs: T0,
        recovery: alignmentRecoveryAsSeenOf({ recovery: takenHidden, visible: true }),
      }),
    ).toBe("The console tries again at 2026-11-11T02:01:00.000Z");
  });
});
