/**
 * The Slack rate-limit error shape, and why one entry in `RATE_LIMIT_CODES` is load-bearing.
 *
 * PR5.2.1b makes the Slack READ clients throw on a 429 (`rejectRateLimitedCalls: true`) so the shared block
 * can see it. `@slack/web-api` throws `WebAPIRateLimitedError` for that case, and its shape is the trap: it
 * carries `code: "slack_webapi_rate_limited_error"` and `retryAfter`, and **no `status`**. Before this PR
 * the mapper knew neither signal, so `resolveKind` fell through to `http`, `hasTransientStatus` was false,
 * and `retryDecision` classified a plain 429 as PERMANENT — the call would have failed outright, unretried,
 * without ever recording the block. Every assertion here is about that one path.
 *
 * The error is reconstructed structurally rather than imported, so the test states the contract it depends
 * on instead of re-deriving it from the SDK; `slackSdkErrorShape` pins the real class against it.
 */
import { WebAPIRateLimitedError } from "@slack/web-api";
import { describe, expect, it } from "vitest";
import { toIngestError } from "../../../lib/ingestError.js";
import { retryDecision } from "../../../lib/resilience.js";

/** A 429 exactly as the Slack SDK raises it once `rejectRateLimitedCalls` is on. */
function slackRateLimited({ retryAfter }: { retryAfter: number }): Error {
  const error = new Error(`A rate-limit has been reached, you may retry this request in ${retryAfter} seconds`);
  Object.assign(error, { code: "slack_webapi_rate_limited_error", retryAfter });
  return error;
}

describe("a Slack 429 surfaced by rejectRateLimitedCalls", () => {
  it("classifies as rate-limit, not as a generic http error", () => {
    const typed = toIngestError({
      defaultKind: "http",
      error: slackRateLimited({ retryAfter: 30 }),
      operation: "slack.conversations.replies",
      provider: "slack",
    });
    expect(typed.kind).toBe("rate-limit");
  });

  it("carries the retry-after hint through as milliseconds, so the block gets an absolute deadline", () => {
    const typed = toIngestError({
      defaultKind: "http",
      error: slackRateLimited({ retryAfter: 30 }),
      operation: "slack.conversations.replies",
      provider: "slack",
    });
    expect(typed.retryAfterMs).toBe(30_000);
  });

  it("is RETRYABLE with reason rate-limit — the classification that records the shared block", () => {
    const typed = toIngestError({
      defaultKind: "http",
      error: slackRateLimited({ retryAfter: 10 }),
      operation: "slack.conversations.history",
      provider: "slack",
    });
    // Asserted whole rather than field by field: `RetryDecision` is a discriminated union, so only the
    // rate-limit arm carries `retryAfterMs` — matching the entire object proves which arm was returned.
    expect(retryDecision({ error: typed })).toEqual({
      reason: "rate-limit",
      retryAfterMs: 10_000,
      retryable: true,
    });
  });

  it("carries no HTTP status at all — the reason the code had to be recognised by name", () => {
    const typed = toIngestError({
      defaultKind: "http",
      error: slackRateLimited({ retryAfter: 5 }),
      operation: "slack.users.list",
      provider: "slack",
    });
    expect(typed.status).toBeUndefined();
    expect(typed.code).toBe("slack_webapi_rate_limited_error");
  });
});

describe("slackSdkErrorShape", () => {
  it("pins the real SDK class to the code and retryAfter this mapper keys on", () => {
    const real = new WebAPIRateLimitedError(42);
    expect(real.code).toBe("slack_webapi_rate_limited_error");
    expect(real.retryAfter).toBe(42);
    // The absence of `status` is the whole trap — assert it on the REAL error, not just the reconstruction.
    expect((real as unknown as { status?: number }).status).toBeUndefined();
  });

  it("maps the real SDK error to rate-limit end to end", () => {
    const typed = toIngestError({
      defaultKind: "http",
      error: new WebAPIRateLimitedError(7),
      operation: "slack.conversations.replies",
      provider: "slack",
    });
    expect(typed.kind).toBe("rate-limit");
    expect(typed.retryAfterMs).toBe(7_000);
  });
});
