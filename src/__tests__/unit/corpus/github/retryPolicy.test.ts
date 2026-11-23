import { describe, expect, it } from "vitest";

import { MAX_THROTTLE_RETRIES, shouldRetryGithubThrottle } from "../../../../corpus/github/retryPolicy.js";

describe("shouldRetryGithubThrottle", () => {
  it("refuses the very first throttling retry for a request that opted out with retries: 0", () => {
    expect(shouldRetryGithubThrottle({ options: { request: { retries: 0 } }, retryCount: 0 })).toBe(false);
  });

  it("keeps the default budget for a request that set no override", () => {
    expect(MAX_THROTTLE_RETRIES).toBe(3);
    expect([0, 1, 2, 3].map((retryCount) => shouldRetryGithubThrottle({ options: {}, retryCount }))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("never reads a non-zero override as a new maximum", () => {
    expect(shouldRetryGithubThrottle({ options: { request: { retries: 10 } }, retryCount: 3 })).toBe(false);
    expect(shouldRetryGithubThrottle({ options: { request: {} }, retryCount: 2 })).toBe(true);
  });
});
