import { describe, expect, it } from "vitest";

import { liveReadBudget, liveReadLaunch } from "../../../codex/liveReadBudget.js";

const NOW_MS = 1_790_000_000_000;

describe("sizing one live batch to its caller's deadline", () => {
  it("takes the standing deadline when the caller has no deadline", () => {
    expect(liveReadBudget({ deadlineAtMs: undefined, nowMs: NOW_MS, standingMs: 8_000, storeCount: 5 })).toEqual({
      deadlineMs: 8_000,
    });
  });

  it("keeps the standing deadline under a far one", () => {
    expect(liveReadBudget({ deadlineAtMs: NOW_MS + 20_000, nowMs: NOW_MS, standingMs: 8_000, storeCount: 1 })).toEqual({
      deadlineMs: 8_000,
    });
  });

  it("shortens the batch so the deadline plus the standing cleanup margin fits what is left", () => {
    expect(liveReadBudget({ deadlineAtMs: NOW_MS + 8_000, nowMs: NOW_MS, standingMs: 8_000, storeCount: 1 })).toEqual({
      deadlineMs: 3_750,
    });
  });

  it("grows the cleanup margin with the store count, as the outer kill's own ceiling does", () => {
    expect(liveReadBudget({ deadlineAtMs: NOW_MS + 8_000, nowMs: NOW_MS, standingMs: 8_000, storeCount: 4 })).toEqual({
      deadlineMs: 3_000,
    });
  });

  // Judged at the launch instant, so time spent before it shrinks the batch rather than stretching it.
  it("shrinks the batch, then refuses the launch, as the judging instant moves later", () => {
    const deadlineAtMs = NOW_MS + 8_000;
    expect(liveReadBudget({ deadlineAtMs, nowMs: NOW_MS + 2_500, standingMs: 8_000, storeCount: 1 })).toEqual({
      deadlineMs: 1_250,
    });
    expect(liveReadBudget({ deadlineAtMs, nowMs: NOW_MS + 2_751, standingMs: 8_000, storeCount: 1 })).toEqual({
      reason:
        "not launched: 5249ms were left before the caller's deadline, under the 5250ms a live read of 1 store(s) needs",
    });
  });

  it("launches nothing, and says why, when what is left cannot hold a read and its cleanup", () => {
    expect(liveReadBudget({ deadlineAtMs: NOW_MS + 5_249, nowMs: NOW_MS, standingMs: 8_000, storeCount: 1 })).toEqual({
      reason:
        "not launched: 5249ms were left before the caller's deadline, under the 5250ms a live read of 1 store(s) needs",
    });
    expect(liveReadBudget({ deadlineAtMs: NOW_MS + 5_250, nowMs: NOW_MS, standingMs: 8_000, storeCount: 1 })).toEqual({
      deadlineMs: 1_000,
    });
  });
});

describe("what one live batch is launched with", () => {
  it("hands Tcl a duration from its own start, and the standing outer timeout, with no caller deadline", () => {
    expect(liveReadLaunch({ deadlineAtMs: undefined, nowMs: NOW_MS, standingMs: 8_000, storeCount: 5 })).toEqual({
      deadlineArg: "8000",
      outerTimeoutMs: 13_250,
    });
  });

  it("hands Tcl the shared deadline as an instant, its outer timeout reaching the caller's measured from the launch instant", () => {
    expect(liveReadLaunch({ deadlineAtMs: NOW_MS + 8_000, nowMs: NOW_MS, standingMs: 8_000, storeCount: 1 })).toEqual({
      deadlineArg: `@${String(NOW_MS + 3_750)}`,
      outerTimeoutMs: 8_000,
    });
  });

  it("launches nothing, and says why, when the budget cannot fit", () => {
    expect(liveReadLaunch({ deadlineAtMs: NOW_MS + 5_249, nowMs: NOW_MS, standingMs: 8_000, storeCount: 1 })).toEqual({
      reason:
        "not launched: 5249ms were left before the caller's deadline, under the 5250ms a live read of 1 store(s) needs",
    });
  });
});
