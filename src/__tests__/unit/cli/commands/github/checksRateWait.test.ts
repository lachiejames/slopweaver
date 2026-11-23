import { describe, expect, it } from "vitest";

import { failedReadStep, UNKNOWN_RESET_WAIT_MS } from "../../../../../cli/commands/github/checksRateWait.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";

const NOW_MS = Date.parse("2026-09-23T09:44:54.000Z");
const DEADLINE_MS = Date.parse("2026-09-23T11:19:20.000Z");
const MESSAGE = "Request failed due to following response errors:\n - API rate limit already exceeded for user ID 1.";

describe("failedReadStep", () => {
  it("waits until one second past a reset that lands inside the deadline, and says until when", () => {
    const error = GithubLiveErrors.rateLimited({ message: MESSAGE, resetAt: "2026-09-23T10:00:00.000Z" });

    expect(failedReadStep({ deadlineMs: DEADLINE_MS, error, nowMs: NOW_MS, timeoutSeconds: 14400 })).toEqual({
      kind: "wait",
      line: "RATE-LIMITED until 2026-09-23T10:00:00.000Z, waiting 907s",
      ms: 907_000,
    });
  });

  it("stops, naming the reset, when the reset lands after the watch's own deadline", () => {
    const error = GithubLiveErrors.rateLimited({ message: MESSAGE, resetAt: "2026-09-23T11:30:00.000Z" });

    expect(failedReadStep({ deadlineMs: DEADLINE_MS, error, nowMs: NOW_MS, timeoutSeconds: 14400 })).toEqual({
      kind: "stop",
      line: "WATCH-FAILED rate-limited until 2026-09-23T11:30:00.000Z, past the 14400s deadline",
    });
  });

  it("retries after the margin alone when the named reset is already behind the clock", () => {
    const error = GithubLiveErrors.rateLimited({ message: MESSAGE, resetAt: "2026-09-23T09:00:00.000Z" });

    expect(failedReadStep({ deadlineMs: DEADLINE_MS, error, nowMs: NOW_MS, timeoutSeconds: 14400 })).toEqual({
      kind: "wait",
      line: "RATE-LIMITED until 2026-09-23T09:00:00.000Z, waiting 1s",
      ms: 1000,
    });
  });

  it("retries on the fixed interval when GitHub named no reset, and stops once that would pass the deadline", () => {
    const error = GithubLiveErrors.rateLimited({ message: MESSAGE, resetAt: undefined });

    expect(failedReadStep({ deadlineMs: DEADLINE_MS, error, nowMs: NOW_MS, timeoutSeconds: 14400 })).toEqual({
      kind: "wait",
      line: "RATE-LIMITED, GitHub named no reset, retrying in 60s",
      ms: UNKNOWN_RESET_WAIT_MS,
    });
    expect(
      failedReadStep({ deadlineMs: NOW_MS + UNKNOWN_RESET_WAIT_MS - 1, error, nowMs: NOW_MS, timeoutSeconds: 60 }),
    ).toEqual({
      kind: "stop",
      line: "WATCH-FAILED rate-limited, GitHub named no reset, 60s deadline too near to retry",
    });
  });

  it("stops on any other failure, with the provider's message folded onto one line", () => {
    const error = GithubLiveErrors.readFailed({ message: "Request failed due to following response errors:\n - boom" });

    expect(failedReadStep({ deadlineMs: DEADLINE_MS, error, nowMs: NOW_MS, timeoutSeconds: 14400 })).toEqual({
      kind: "stop",
      line: "WATCH-FAILED Request failed due to following response errors: - boom",
    });
  });
});
