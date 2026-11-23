import { describe, expect, it } from "vitest";
import { ciVerdict } from "../../../../review/reviewState.js";

describe("ciVerdict", () => {
  it("reports none when the head commit carries no checks at all", () => {
    expect(ciVerdict({ checks: { failed: 0, passed: 0, queued: 0, running: 0, total: 0 } })).toBe("none");
  });

  it("reports red the moment one check has failed, even with others still running", () => {
    expect(ciVerdict({ checks: { failed: 1, passed: 3, queued: 0, running: 2, total: 6 } })).toBe("red");
  });

  it("reports running while a check is queued, which GitHub's own aggregate can call SUCCESS", () => {
    expect(ciVerdict({ checks: { failed: 0, passed: 5, queued: 1, running: 0, total: 6 } })).toBe("running");
  });

  it("reports green only once every check is terminal and none failed", () => {
    expect(ciVerdict({ checks: { failed: 0, passed: 6, queued: 0, running: 0, total: 6 } })).toBe("green");
  });
});
