import { describe, expect, it } from "vitest";

import { verdictToAnnounce } from "../../../../../cli/commands/github/checksVerdict.js";
import type { GithubChecksSnapshot } from "../../../../../live/github/checks.js";
import type { GithubCheck } from "../../../../../live/github/checksDedupe.js";
import type { RequiredContextGate } from "../../../../../live/github/requiredContexts.js";

function snapshot({ checks }: { checks: readonly GithubCheck[] }): GithubChecksSnapshot {
  return {
    baseRef: "main",
    checks,
    headSha: "abc123def456",
    mergeable: undefined,
    residue: [],
    rollupState: "SUCCESS",
    supersededChecks: [],
    truncated: false,
  };
}

function gate({
  missing = [],
  unproven = [],
}: {
  missing?: readonly string[];
  unproven?: readonly string[];
} = {}): RequiredContextGate {
  return { branch: "main", kind: "read", mergeable: undefined, missing, required: ["build"], unproven };
}

const PASSED: GithubCheck = { kind: "check-run", name: "build", state: "passed", url: undefined };
const FAILED: GithubCheck = { kind: "check-run", name: "lint", state: "failed", url: undefined };
const RUNNING: GithubCheck = { kind: "check-run", name: "unit", state: "running", url: undefined };
const SEEN = { previousHead: "abc123def456", verdictHead: undefined };

describe("verdictToAnnounce", () => {
  it("announces nothing on the baseline poll, nor twice for a head it already announced", () => {
    const green = snapshot({ checks: [PASSED] });

    expect(
      verdictToAnnounce({
        gate: gate(),
        head: "abc123def456",
        snapshot: green,
        state: { ...SEEN, previousHead: undefined },
      }),
    ).toBeUndefined();
    expect(
      verdictToAnnounce({
        gate: gate(),
        head: "abc123def456",
        snapshot: green,
        state: { ...SEEN, verdictHead: "abc123def456" },
      }),
    ).toBeUndefined();
  });

  it("announces nothing while a check still runs", () => {
    expect(
      verdictToAnnounce({
        gate: gate(),
        head: "abc123def456",
        snapshot: snapshot({ checks: [PASSED, RUNNING] }),
        state: SEEN,
      }),
    ).toBeUndefined();
  });

  it("names the failed checks, and fails a required context that never ran or is unproven", () => {
    expect(
      verdictToAnnounce({
        gate: gate(),
        head: "abc123def456",
        snapshot: snapshot({ checks: [PASSED, FAILED] }),
        state: SEEN,
      }),
    ).toEqual({ failed: true, line: "CI FAIL lint on abc123de" });
    expect(
      verdictToAnnounce({
        gate: gate({ missing: ["build"] }),
        head: "abc123def456",
        snapshot: snapshot({ checks: [PASSED] }),
        state: SEEN,
      }),
    ).toEqual({ failed: true, line: "CI FAIL required context never ran: build on abc123de" });
    expect(
      verdictToAnnounce({
        gate: gate({ unproven: ["build"] }),
        head: "abc123def456",
        snapshot: snapshot({ checks: [PASSED] }),
        state: SEEN,
      }),
    ).toEqual({ failed: true, line: "CI FAIL required context UNPROVEN on a truncated read: build on abc123de" });
  });

  it("passes a green head with every required context present, and says so", () => {
    expect(
      verdictToAnnounce({ gate: gate(), head: "abc123def456", snapshot: snapshot({ checks: [PASSED] }), state: SEEN }),
    ).toEqual({ failed: false, line: "CI PASS 1/1 on abc123de, 1/1 required present" });
  });
});
