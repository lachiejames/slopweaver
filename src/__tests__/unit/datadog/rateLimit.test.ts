import { describe, expect, it } from "vitest";

import {
  describeRateLimit,
  describeRateLimitWait,
  parseRateLimit,
  type RateLimitSnapshot,
} from "../../../datadog/rateLimit.js";

/** The exact headers a live 429 from a tightly rate-limited aggregate endpoint carries. */
const LIVE_429 = {
  "x-ratelimit-limit": "2",
  "x-ratelimit-period": "10",
  "x-ratelimit-remaining": "0",
  "x-ratelimit-reset": "9",
  "x-ratelimit-name": "logs_public_analytics_aggregate",
};

/** A throwing narrower, so an assertion never hides behind a `?.` — see the testing rules. */
function snapshotOf({ headers }: { headers: Record<string, string> }): RateLimitSnapshot {
  const snapshot = parseRateLimit({ headers });
  if (snapshot === null) {
    throw new Error("expected a metered response");
  }
  return snapshot;
}

describe("parseRateLimit", () => {
  it("reads a live rate-limited response", () => {
    expect(snapshotOf({ headers: LIVE_429 })).toEqual({
      limit: 2,
      period: 10,
      remaining: 0,
      resetSeconds: 9,
      name: "logs_public_analytics_aggregate",
    });
  });

  it("returns null for an unmetered response, so an absent budget is not read as a zero one", () => {
    expect(parseRateLimit({ headers: { "content-type": "application/json" } })).toBe(null);
  });

  it("returns null for no headers at all", () => {
    expect(parseRateLimit({ headers: {} })).toBe(null);
  });

  it("finds headers regardless of case", () => {
    const snapshot = snapshotOf({ headers: { "X-RateLimit-Reset": "4", "X-RateLimit-Name": "logs" } });
    expect(snapshot.resetSeconds).toBe(4);
    expect(snapshot.name).toBe("logs");
  });

  it("keeps an empty header found under another casing as the empty string it carried, not as absent", () => {
    expect(snapshotOf({ headers: { "X-RateLimit-Name": "" } }).name).toBe("");
  });

  it("reads a header absent under every casing as null", () => {
    expect(snapshotOf({ headers: { "X-RateLimit-Reset": "4" } }).name).toBe(null);
  });

  it("treats a partially-metered response as metered, reporting the rest as unknown", () => {
    const snapshot = snapshotOf({ headers: { "x-ratelimit-reset": "7" } });
    expect(snapshot).toEqual({ limit: null, period: null, remaining: null, resetSeconds: 7, name: null });
  });

  it("reads a zero remaining as zero rather than as absent", () => {
    expect(snapshotOf({ headers: { "x-ratelimit-remaining": "0" } }).remaining).toBe(0);
  });

  it("rejects a non-integer value instead of taking its numeric prefix", () => {
    expect(snapshotOf({ headers: { "x-ratelimit-reset": "9abc", "x-ratelimit-limit": "2" } }).resetSeconds).toBe(null);
  });

  it("rejects a negative value", () => {
    expect(snapshotOf({ headers: { "x-ratelimit-limit": "2", "x-ratelimit-reset": "-1" } }).resetSeconds).toBe(null);
  });
});

describe("describeRateLimit", () => {
  it("names the limit and what is left of it", () => {
    expect(describeRateLimit({ snapshot: snapshotOf({ headers: LIVE_429 }) })).toBe(
      "logs_public_analytics_aggregate: 2 per 10s, 0 left, resets in 9s",
    );
  });

  it("says what it does not know rather than inventing a number", () => {
    expect(
      describeRateLimit({ snapshot: { limit: null, period: null, remaining: null, resetSeconds: null, name: null } }),
    ).toBe("unnamed limit: budget unknown, remaining unknown, no reset signal");
  });

  it("names an unnamed limit beside the budget it did report", () => {
    expect(describeRateLimit({ snapshot: { limit: 2, period: 10, remaining: 1, resetSeconds: 4, name: null } })).toBe(
      "unnamed limit: 2 per 10s, 1 left, resets in 4s",
    );
  });
});

describe("describeRateLimitWait", () => {
  it("names the wait taken from the reset header", () => {
    expect(describeRateLimitWait({ snapshot: snapshotOf({ headers: LIVE_429 }) })).toBe(
      "Datadog rate-limited this request on logs_public_analytics_aggregate; waiting 9s for the window to reset",
    );
  });

  it("still announces a wait when the 429 carried no headers", () => {
    expect(describeRateLimitWait({ snapshot: null })).toBe(
      "Datadog rate-limited this request and sent no rate-limit headers; retrying after 2s",
    );
  });

  it("falls back to the backoff base when the reset header is missing", () => {
    expect(
      describeRateLimitWait({ snapshot: { limit: 2, period: 10, remaining: 0, resetSeconds: null, name: "logs" } }),
    ).toBe("Datadog rate-limited this request on logs; waiting 2s for the window to reset");
  });

  it("names an unnamed limit while still giving the reset it did send", () => {
    expect(
      describeRateLimitWait({ snapshot: { limit: null, period: null, remaining: 0, resetSeconds: 5, name: null } }),
    ).toBe("Datadog rate-limited this request on an unnamed limit; waiting 5s for the window to reset");
  });

  it("takes a zero-second reset as zero rather than as a missing one", () => {
    expect(
      describeRateLimitWait({ snapshot: { limit: 2, period: 10, remaining: 0, resetSeconds: 0, name: "logs" } }),
    ).toBe("Datadog rate-limited this request on logs; waiting 0s for the window to reset");
  });
});
