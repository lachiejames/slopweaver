import { describe, expect, it } from "vitest";

import { readinessGaps, SLACK_UPLOAD_READINESS_GAPS } from "../../../../corpus/slack/readinessSchedule.js";
import { readinessFailureReason } from "../../../../corpus/slack/writeTransport.js";

describe("readinessGaps", () => {
  it("doubles from the first gap until it reaches the cap", () => {
    expect(readinessGaps({ firstGapMs: 400, maxGapMs: 5_000, totalMs: 20_000 })).toEqual([
      400, 800, 1600, 3200, 5000, 5000,
    ]);
  });

  it("never schedules a sleep that would run past the total", () => {
    const gaps = readinessGaps({ firstGapMs: 400, maxGapMs: 5_000, totalMs: 20_000 });

    expect(gaps.reduce((sum, gap) => sum + gap, 0)).toBe(16_000);
  });

  it("is empty when not even the first gap fits", () => {
    expect(readinessGaps({ firstGapMs: 400, maxGapMs: 5_000, totalMs: 100 })).toEqual([]);
  });

  it("schedules exactly one gap when only the first one fits", () => {
    expect(readinessGaps({ firstGapMs: 400, maxGapMs: 5_000, totalMs: 400 })).toEqual([400]);
  });

  it("stays at the first gap when the cap is that gap", () => {
    expect(readinessGaps({ firstGapMs: 500, maxGapMs: 500, totalMs: 2_000 })).toEqual([500, 500, 500, 500]);
  });
});

describe("SLACK_UPLOAD_READINESS_GAPS — the live poll's own schedule", () => {
  it("waits far longer than the 15-poll/400ms bound the two live failures outlived", () => {
    expect(SLACK_UPLOAD_READINESS_GAPS.reduce((sum, gap) => sum + gap, 0)).toBe(116_000);
  });

  it("catches a nearly-ready file inside the first second, as the old flat cadence did", () => {
    expect(SLACK_UPLOAD_READINESS_GAPS.slice(0, 3)).toEqual([400, 800, 1600]);
  });

  it("spends its two minutes in 27 polls rather than three hundred", () => {
    expect(SLACK_UPLOAD_READINESS_GAPS.length + 1).toBe(27);
  });
});

describe("readinessFailureReason", () => {
  it("says Slack was still working when files.info answered but the file was not done", () => {
    expect(readinessFailureReason({ outcome: { kind: "still-processing", polls: 27, waitedMs: 118_200 } })).toBe(
      "Slack never finished processing it in 27 poll(s) over 118.2s",
    );
  });

  it("says files.info itself never answered, and carries the last error", () => {
    expect(
      readinessFailureReason({
        outcome: { kind: "unreadable", lastError: "ratelimited", polls: 27, waitedMs: 118_200 },
      }),
    ).toBe("files.info never succeeded in 27 poll(s) over 118.2s (last: ratelimited)");
  });

  it("has nothing to report about a ready file", () => {
    expect(readinessFailureReason({ outcome: { kind: "ready", polls: 1, waitedMs: 120 } })).toBe("");
  });
});
