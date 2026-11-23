/**
 * A Graph SDK throw reaches the shared classifier as what it really was: a request with no response as a
 * network failure, a 429 with its own wait, and Graph's error code kept for a caller to branch on.
 */
import { describe, expect, it } from "vitest";
import { toIngestError } from "#lib/ingestError.js";
import { GraphError } from "../../../../live/outlook/client.js";

import { GraphCallError, graphCodeIs, normaliseGraphThrow } from "../../../../live/outlook/graphThrow.js";

/** A GraphError as the SDK's error handler builds one from a response. */
function answered({ status, code, retryAfter }: { status: number; code: string; retryAfter?: string }): GraphError {
  const error = new GraphError(status, `${code} message`);
  error.code = code;
  error.headers = new Headers(retryAfter === undefined ? {} : { "retry-after": retryAfter });
  return error;
}

describe("normaliseGraphThrow", () => {
  it("turns a request that got no response into a network failure, not HTTP -1", () => {
    const sdk = new GraphError(-1, "fetch failed");
    sdk.code = "TypeError";

    const typed = toIngestError({
      defaultKind: "http",
      error: normaliseGraphThrow({ error: sdk }),
      operation: "outlook.messages.list",
      provider: "outlook",
    });

    expect(typed.kind).toBe("network");
    expect(typed.status).toBe(undefined);
  });

  it("carries a 429's Retry-After through to the classifier", () => {
    const typed = toIngestError({
      defaultKind: "http",
      error: normaliseGraphThrow({ error: answered({ code: "TooManyRequests", retryAfter: "7", status: 429 }) }),
      operation: "outlook.messages.list",
      provider: "outlook",
    });

    expect(typed.kind).toBe("rate-limit");
    expect(typed.retryAfterMs).toBe(7000);
  });

  it.each([["1e308"], ["Infinity"], ["86400"]])("holds a Retry-After of %s to the two-minute ceiling", (retryAfter) => {
    const typed = toIngestError({
      defaultKind: "http",
      error: normaliseGraphThrow({ error: answered({ code: "TooManyRequests", retryAfter, status: 429 }) }),
      operation: "outlook.messages.list",
      provider: "outlook",
    });

    expect(typed.retryAfterMs).toBe(120_000);
  });

  it("keeps Graph's own error code for a caller to branch on", () => {
    const thrown = normaliseGraphThrow({ error: answered({ code: "InefficientFilter", status: 400 }) });

    expect(thrown).toBeInstanceOf(GraphCallError);
    expect(graphCodeIs({ cause: thrown, code: "InefficientFilter" })).toBe(true);
    expect(graphCodeIs({ cause: thrown, code: "ErrorItemNotFound" })).toBe(false);
  });

  it("passes a value that is not a GraphError through unchanged", () => {
    const other = new RangeError("not graph");

    expect(normaliseGraphThrow({ error: other })).toBe(other);
  });
});
