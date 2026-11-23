import { describe, expect, it } from "vitest";

import { headerValue, retryWaitSeconds } from "../../../../atlas/vanta/retryBackoff.js";

describe("retryWaitSeconds", () => {
  it("backs a 429 with no Retry-After off 15s, 30s, then 60s", () => {
    const waits = [0, 1, 2].map((attempt) => retryWaitSeconds({ attempt, headers: {}, status: 429 }));
    expect(waits).toEqual([15, 30, 60]);
  });

  it("keeps every other retryable fault on 2s, 4s, 8s", () => {
    const serverError = [0, 1, 2].map((attempt) => retryWaitSeconds({ attempt, headers: {}, status: 503 }));
    const noResponse = [0, 1, 2].map((attempt) => retryWaitSeconds({ attempt, headers: {}, status: null }));
    expect(serverError).toEqual([2, 4, 8]);
    expect(noResponse).toEqual([2, 4, 8]);
  });

  it("takes a whole delay-seconds Retry-After over either ladder, whatever the header's case", () => {
    expect(retryWaitSeconds({ attempt: 2, headers: { "Retry-After": " 7 " }, status: 429 })).toBe(7);
  });

  it("caps a Retry-After at 60s", () => {
    expect(retryWaitSeconds({ attempt: 0, headers: { "retry-after": "600" }, status: 429 })).toBe(60);
  });

  it("ignores a malformed or HTTP-date Retry-After and falls back to the ladder", () => {
    expect(retryWaitSeconds({ attempt: 0, headers: { "retry-after": "5garbage" }, status: 429 })).toBe(15);
    const httpDate = "Wed, 21 Oct 2026 07:28:00 GMT";
    expect(retryWaitSeconds({ attempt: 1, headers: { "retry-after": httpDate }, status: 503 })).toBe(4);
  });
});

describe("headerValue", () => {
  it("finds a header case-insensitively and answers null when it was not sent", () => {
    expect(headerValue({ headers: { Authorization: "x" }, name: "authorization" })).toBe("x");
    expect(headerValue({ headers: {}, name: "retry-after" })).toBeNull();
  });
});
