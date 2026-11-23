/**
 * The scheduled recovery sweep's cadence and window math — pure, so every boundary is a plain call.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  nextRecoveryDue,
  parseRecoverySweepState,
  RECOVERY_INTERVAL_MS,
  type RecoverySweepState,
  recoveryWindow,
} from "../../../../live/listen/recoverSchedule.js";

const NOW_MS = Date.parse("2026-08-13T12:00:00.000Z");

describe("RECOVERY_INTERVAL_MS", () => {
  it("is five minutes", () => {
    expect(RECOVERY_INTERVAL_MS).toBe(300_000);
  });
});

describe("recoveryWindow", () => {
  it("bootstraps from --since when there is no watermark yet", () => {
    const window = unwrap(
      recoveryWindow({
        bootstrapSinceIso: "2026-08-10T00:00:00.000Z",
        completedThroughTs: undefined,
        nowMs: NOW_MS,
      }),
    );
    expect(window).toEqual({
      latestExclusiveTs: "1786622400.000000",
      oldestExclusiveTs: "1786320000.000000",
      sinceIso: "2026-08-10T00:00:00.000Z",
      untilIso: "2026-08-13T12:00:00.000Z",
    });
  });

  it("refuses a bootstrap --since that will not parse as ISO-8601", () => {
    const error = unwrapErr(
      recoveryWindow({ bootstrapSinceIso: "whenever", completedThroughTs: undefined, nowMs: NOW_MS }),
    );
    expect(error.code).toBe("INVALID_SINCE");
    expect(error.message).toBe(`bootstrap --since "whenever" is not a valid ISO-8601 instant`);
  });

  it("refuses a bootstrap --since that is not before now", () => {
    const error = unwrapErr(
      recoveryWindow({ bootstrapSinceIso: "2026-08-14T00:00:00.000Z", completedThroughTs: undefined, nowMs: NOW_MS }),
    );
    expect(error.code).toBe("SINCE_NOT_BEFORE_NOW");
    expect(error.message).toBe(
      `bootstrap --since "2026-08-14T00:00:00.000Z" is not before now (2026-08-13T12:00:00.000Z)`,
    );
  });

  it("continues one microsecond after the stored watermark, exactly", () => {
    const window = unwrap(
      recoveryWindow({
        bootstrapSinceIso: "2026-08-10T00:00:00.000Z",
        completedThroughTs: "1786600000.500000",
        nowMs: NOW_MS,
      }),
    );
    expect(window).toEqual({
      latestExclusiveTs: "1786622400.000000",
      oldestExclusiveTs: "1786600000.499999",
      sinceIso: "2026-08-13T05:46:40.000Z",
      untilIso: "2026-08-13T12:00:00.000Z",
    });
  });

  it("borrows a whole second when the watermark's microseconds are exactly zero", () => {
    const window = unwrap(
      recoveryWindow({
        bootstrapSinceIso: "2026-08-10T00:00:00.000Z",
        completedThroughTs: "1786600000.000000",
        nowMs: NOW_MS,
      }),
    );
    expect(window.oldestExclusiveTs).toBe("1786599999.999999");
  });

  /**
   * The window misreading, pinned as a property. A sweep's reported `window` is computed from the
   * watermark AS IT STOOD BEFORE the sweep ran, and the advance is written after — so `oldestExclusiveTs`
   * sitting at an old instant inside a `completeness: "complete"` report is not evidence of anything. Both
   * literals below are the real measured values: the window the sweep printed, and the
   * `completedThroughTs` that same pass left behind.
   */
  it("reports the window of the watermark BEFORE the sweep, never the one that sweep will advance to", () => {
    const startedMs = Date.parse("2026-08-26T07:53:47.211Z");

    const first = unwrap(
      recoveryWindow({
        bootstrapSinceIso: "2026-08-10T00:00:00.000Z",
        completedThroughTs: "1787661513.653000",
        nowMs: startedMs,
      }),
    );

    expect(first.oldestExclusiveTs).toBe("1787661513.652999");
    expect(first.latestExclusiveTs).toBe("1787730827.211000");

    // A complete sweep persists `latestExclusiveTs` as the new watermark; only the NEXT window shows it.
    const second = unwrap(
      recoveryWindow({
        bootstrapSinceIso: "2026-08-10T00:00:00.000Z",
        completedThroughTs: first.latestExclusiveTs,
        nowMs: startedMs + RECOVERY_INTERVAL_MS,
      }),
    );

    expect(second.oldestExclusiveTs).toBe("1787730827.210999");
    // `sinceIso` is the watermark rendered for the report, truncated to the second.
    expect(second.sinceIso).toBe("2026-08-26T07:53:47.000Z");
  });

  it("opens a window as wide as the gap since the last COMPLETE sweep, not as wide as the cadence", () => {
    const window = unwrap(
      recoveryWindow({
        bootstrapSinceIso: "2026-08-10T00:00:00.000Z",
        completedThroughTs: "1787661513.653000",
        nowMs: Date.parse("2026-08-26T07:53:47.211Z"),
      }),
    );

    expect(window.sinceIso).toBe("2026-08-25T12:38:33.000Z");
    // Nineteen and a quarter hours, because that is how long it had been since a sweep last COMPLETED.
    expect(Date.parse(window.untilIso) - Date.parse(window.sinceIso)).toBe(69_314_211);
  });

  it("refuses a stored watermark that is not a Slack decimal timestamp", () => {
    const error = unwrapErr(
      recoveryWindow({ bootstrapSinceIso: "2026-08-10T00:00:00.000Z", completedThroughTs: "not-a-ts", nowMs: NOW_MS }),
    );
    expect(error.code).toBe("NOT_SLACK_TS");
    expect(error.message).toBe(`"not-a-ts" is not a Slack decimal timestamp (epochSeconds.micros)`);
  });

  it("refuses a stored watermark that is not before now", () => {
    const error = unwrapErr(
      recoveryWindow({
        bootstrapSinceIso: "2026-08-10T00:00:00.000Z",
        completedThroughTs: "1786622400.000001",
        nowMs: NOW_MS,
      }),
    );
    expect(error.code).toBe("WATERMARK_NOT_BEFORE_NOW");
    expect(error.message).toBe(`the stored watermark "1786622400.000001" is not before now (2026-08-13T12:00:00.000Z)`);
  });
});

describe("nextRecoveryDue", () => {
  it("is due immediately when no sweep has ever run", () => {
    expect(nextRecoveryDue({ nowMs: NOW_MS, state: undefined })).toBe(NOW_MS);
  });

  it("reads the recorded next-due instant", () => {
    const state: RecoverySweepState = { nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 };
    expect(nextRecoveryDue({ nowMs: NOW_MS, state })).toBe(Date.parse("2026-08-13T12:05:00.000Z"));
  });

  it("falls back to now when the recorded next-due instant will not parse", () => {
    const state: RecoverySweepState = { nextDueAtIso: "whenever", version: 1 };
    expect(nextRecoveryDue({ nowMs: NOW_MS, state })).toBe(NOW_MS);
  });
});

describe("parseRecoverySweepState", () => {
  it("treats no file yet as valid — never swept", () => {
    expect(unwrap(parseRecoverySweepState({ raw: undefined }))).toBeUndefined();
  });

  it("accepts a bootstrap state with no watermark yet", () => {
    const state = unwrap(parseRecoverySweepState({ raw: { nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 } }));
    expect(state).toEqual({ nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 });
  });

  it("accepts a state carrying a watermark", () => {
    const state = unwrap(
      parseRecoverySweepState({
        raw: { completedThroughTs: "1786700000.000000", nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 },
      }),
    );
    expect(state).toEqual({
      completedThroughTs: "1786700000.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      version: 1,
    });
  });

  it("refuses a non-object", () => {
    const error = unwrapErr(parseRecoverySweepState({ raw: "nope" }));
    expect(error.code).toBe("SWEEP_STATE_NOT_AN_OBJECT");
    expect(error.message).toBe("recovery sweep state is not a JSON object");
  });

  it("refuses an unsupported version", () => {
    const error = unwrapErr(parseRecoverySweepState({ raw: { nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 3 } }));
    expect(error.code).toBe("SWEEP_STATE_UNSUPPORTED_VERSION");
    expect(error.message).toBe("recovery sweep state has unsupported version 3, expected 1 or 2");
  });

  it("refuses a missing nextDueAtIso", () => {
    const error = unwrapErr(parseRecoverySweepState({ raw: { version: 1 } }));
    expect(error.message).toBe("recovery sweep state's nextDueAtIso undefined is not a valid ISO-8601 instant");
  });

  it("refuses a nextDueAtIso that will not parse as ISO-8601", () => {
    const error = unwrapErr(parseRecoverySweepState({ raw: { nextDueAtIso: "whenever", version: 1 } }));
    expect(error.message).toBe(`recovery sweep state's nextDueAtIso "whenever" is not a valid ISO-8601 instant`);
  });

  it("refuses a completedThroughTs that is not a Slack decimal timestamp", () => {
    const error = unwrapErr(
      parseRecoverySweepState({
        raw: { completedThroughTs: "not-a-ts", nextDueAtIso: "2026-08-13T12:05:00.000Z", version: 1 },
      }),
    );
    expect(error.code).toBe("SWEEP_STATE_INVALID_COMPLETED_THROUGH");
    expect(error.message).toBe(`recovery sweep state's completedThroughTs "not-a-ts" is not a Slack decimal timestamp`);
  });

  it("accepts a V2 state carrying an empty thread-checkpoint inventory", () => {
    const state = unwrap(
      parseRecoverySweepState({
        raw: { nextDueAtIso: "2026-08-13T12:05:00.000Z", threadCheckpoints: {}, version: 2 },
      }),
    );
    expect(state).toEqual({ nextDueAtIso: "2026-08-13T12:05:00.000Z", threadCheckpoints: {}, version: 2 });
  });

  it("accepts a V2 state carrying real checkpoints, with and without lastCheckedAtIso", () => {
    const state = unwrap(
      parseRecoverySweepState({
        raw: {
          completedThroughTs: "1786700000.000000",
          nextDueAtIso: "2026-08-13T12:05:00.000Z",
          threadCheckpoints: {
            "C1:1785000000.000100": { cursorTs: "1785000100.000200" },
            "C2:1785000000.000200": { cursorTs: "1785000200.000300", lastCheckedAtIso: "2026-08-13T12:00:00.000Z" },
          },
          version: 2,
        },
      }),
    );
    expect(state).toEqual({
      completedThroughTs: "1786700000.000000",
      nextDueAtIso: "2026-08-13T12:05:00.000Z",
      threadCheckpoints: {
        "C1:1785000000.000100": { cursorTs: "1785000100.000200" },
        "C2:1785000000.000200": { cursorTs: "1785000200.000300", lastCheckedAtIso: "2026-08-13T12:00:00.000Z" },
      },
      version: 2,
    });
  });

  it("refuses a V2 state whose threadCheckpoints is not an object", () => {
    const error = unwrapErr(
      parseRecoverySweepState({
        raw: { nextDueAtIso: "2026-08-13T12:05:00.000Z", threadCheckpoints: "nope", version: 2 },
      }),
    );
    expect(error.code).toBe("SWEEP_STATE_INVALID_THREAD_CHECKPOINTS");
  });

  it("refuses a V2 checkpoint entry whose cursorTs is not a Slack decimal timestamp", () => {
    const error = unwrapErr(
      parseRecoverySweepState({
        raw: {
          nextDueAtIso: "2026-08-13T12:05:00.000Z",
          threadCheckpoints: { "C1:1785000000.000100": { cursorTs: "not-a-ts" } },
          version: 2,
        },
      }),
    );
    expect(error.code).toBe("SWEEP_STATE_INVALID_THREAD_CHECKPOINTS");
  });

  it("refuses a V2 checkpoint entry whose lastCheckedAtIso will not parse as ISO-8601", () => {
    const error = unwrapErr(
      parseRecoverySweepState({
        raw: {
          nextDueAtIso: "2026-08-13T12:05:00.000Z",
          threadCheckpoints: {
            "C1:1785000000.000100": { cursorTs: "1785000100.000200", lastCheckedAtIso: "whenever" },
          },
          version: 2,
        },
      }),
    );
    expect(error.code).toBe("SWEEP_STATE_INVALID_THREAD_CHECKPOINTS");
  });
});
