/**
 * `summarizeChecks` and `isChecksTerminal` — the per-state count of a check list, and whether that count has
 * settled with nothing left running or queued.
 */
import { describe, expect, it } from "vitest";

import { isChecksTerminal, summarizeChecks } from "../../../../../live/github/checks.js";

describe("summarizeChecks", () => {
  it("counts each state independently", () => {
    const summary = summarizeChecks({
      checks: [
        { kind: "check-run", name: "a", state: "passed", url: undefined },
        { kind: "check-run", name: "b", state: "passed", url: undefined },
        { kind: "check-run", name: "c", state: "failed", url: undefined },
        { kind: "check-run", name: "d", state: "running", url: undefined },
        { kind: "check-run", name: "e", state: "queued", url: undefined },
      ],
    });

    expect(summary).toEqual({ failed: 1, passed: 2, queued: 1, running: 1, total: 5 });
  });

  it("answers all-zero for an empty check list", () => {
    expect(summarizeChecks({ checks: [] })).toEqual({ failed: 0, passed: 0, queued: 0, running: 0, total: 0 });
  });
});

describe("isChecksTerminal", () => {
  it("is terminal once nothing is running or queued", () => {
    expect(isChecksTerminal({ summary: { failed: 1, passed: 2, queued: 0, running: 0, total: 3 } })).toBe(true);
  });

  it("is not terminal while a check is still running", () => {
    expect(isChecksTerminal({ summary: { failed: 0, passed: 2, queued: 0, running: 1, total: 3 } })).toBe(false);
  });

  it("is vacuously terminal when there are zero checks", () => {
    expect(isChecksTerminal({ summary: { failed: 0, passed: 0, queued: 0, running: 0, total: 0 } })).toBe(true);
  });
});
