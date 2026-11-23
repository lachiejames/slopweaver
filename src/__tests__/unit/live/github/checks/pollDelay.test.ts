/**
 * `nextChecksPollDelayMs` — the stepped wait between two checks polls, and the 60s ceiling past its end.
 */
import { describe, expect, it } from "vitest";

import { nextChecksPollDelayMs } from "../../../../../live/github/checks.js";

describe("nextChecksPollDelayMs", () => {
  it("follows the stepped schedule for the first few attempts", () => {
    expect(nextChecksPollDelayMs({ attempt: 0 })).toBe(10_000);
    expect(nextChecksPollDelayMs({ attempt: 1 })).toBe(20_000);
    expect(nextChecksPollDelayMs({ attempt: 2 })).toBe(30_000);
    expect(nextChecksPollDelayMs({ attempt: 3 })).toBe(45_000);
  });

  it("falls back to the 60s ceiling past the end of the schedule", () => {
    expect(nextChecksPollDelayMs({ attempt: 4 })).toBe(60_000);
    expect(nextChecksPollDelayMs({ attempt: 40 })).toBe(60_000);
  });
});
