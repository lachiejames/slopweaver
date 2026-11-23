import { describe, expect, it } from "vitest";

import { fetchFailureRetries, retryDelayMs } from "../../lib/liveRetry";

describe("which failed console reads are owed again", () => {
  it("re-reads when the fetch itself threw — the server refused or reset the connection mid-swap", () => {
    expect(fetchFailureRetries({ status: undefined, threw: true })).toBe(true);
  });

  it("re-reads a 5xx, which the route never sends for a verb's own failure", () => {
    expect(fetchFailureRetries({ status: 500, threw: false })).toBe(true);
    expect(fetchFailureRetries({ status: 502, threw: false })).toBe(true);
    expect(fetchFailureRetries({ status: 503, threw: false })).toBe(true);
  });

  it("does not re-read a 404 for a slug the page should never have asked for, nor a 2xx it could not read", () => {
    expect(fetchFailureRetries({ status: 404, threw: false })).toBe(false);
    expect(fetchFailureRetries({ status: 200, threw: false })).toBe(false);
    expect(fetchFailureRetries({ status: 499, threw: false })).toBe(false);
  });

  it("does not re-read when no fetch threw and there is no status to judge", () => {
    expect(fetchFailureRetries({ status: undefined, threw: false })).toBe(false);
  });
});

describe("how long a re-read waits", () => {
  it("doubles from one second and holds at fifteen", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map((attempt) => retryDelayMs({ attempt }))).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000,
    ]);
  });
});
