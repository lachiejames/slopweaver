/**
 * The race's decision, in isolation: first-writer-wins, idempotent for the winning arm, and the opposing
 * arm always loses once either side has decided.
 */
import { describe, expect, it } from "vitest";

import { createDeadlineArbiter, deadlineDelayMs } from "../../../../live/listen/deadline.js";

describe("createDeadlineArbiter", () => {
  it("is pending until either arm tries", () => {
    expect(createDeadlineArbiter().winner()).toBe("pending");
  });

  it("a Slack address wins when it tries first", () => {
    const arbiter = createDeadlineArbiter();
    expect(arbiter.trySlackAddress()).toBe(true);
    expect(arbiter.winner()).toBe("slack-address");
  });

  it("the clock wins when it tries first", () => {
    const arbiter = createDeadlineArbiter();
    expect(arbiter.tryClockWake()).toBe(true);
    expect(arbiter.winner()).toBe("clock-wake");
  });

  it("the opposing arm loses once the first has won", () => {
    const arbiter = createDeadlineArbiter();
    arbiter.trySlackAddress();
    expect(arbiter.tryClockWake()).toBe(false);
    expect(arbiter.winner()).toBe("slack-address");
  });

  it("the clock loses to an address that already won, even tried after", () => {
    const arbiter = createDeadlineArbiter();
    arbiter.trySlackAddress();
    arbiter.tryClockWake();
    expect(arbiter.winner()).toBe("slack-address");
  });

  it("a repeated try by the SAME winning arm is idempotent — still true, nothing changes", () => {
    const arbiter = createDeadlineArbiter();
    arbiter.tryClockWake();
    expect(arbiter.tryClockWake()).toBe(true);
    expect(arbiter.winner()).toBe("clock-wake");
  });

  it("a repeated try by the losing arm stays false", () => {
    const arbiter = createDeadlineArbiter();
    arbiter.tryClockWake();
    expect(arbiter.trySlackAddress()).toBe(false);
    expect(arbiter.trySlackAddress()).toBe(false);
    expect(arbiter.winner()).toBe("clock-wake");
  });
});

describe("deadlineDelayMs", () => {
  it("is the exact difference for a future deadline", () => {
    expect(deadlineDelayMs({ deadlineMs: 10_000, nowMs: 4_000 })).toBe(6_000);
  });

  it("is zero for a deadline exactly now", () => {
    expect(deadlineDelayMs({ deadlineMs: 5_000, nowMs: 5_000 })).toBe(0);
  });

  it("floors a past deadline at zero rather than going negative", () => {
    expect(deadlineDelayMs({ deadlineMs: 1_000, nowMs: 9_000 })).toBe(0);
  });
});
