import { describe, expect, it } from "vitest";
import type { LintCheck } from "../../../../devLint/devLint.js";
import { withheldOutcome } from "../../../../devLint/gateRunner.js";

const OXLINT: LintCheck = { args: ["--", "src/a.ts"], cmd: "/bin/oxlint", name: "oxlint", runsLast: true };
const REASON = "a lap holds this machine (pid 4242, running, acme/widgets#116)";

describe("withheldOutcome", () => {
  it("settles a withheld gate as NOT ok, carrying its reason and no output of its own", () => {
    const outcome = withheldOutcome({ check: OXLINT, reason: REASON });

    expect(outcome.result).toEqual({ name: "oxlint", ok: false, withheld: REASON });
    expect(outcome.stdout).toBe("");
  });

  it("prints the four-line refusal naming the gate and the reason where its output would have been", () => {
    const lines = withheldOutcome({ check: OXLINT, reason: REASON }).stderr.trimEnd().split("\n");

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain(`oxlint: ${REASON}`);
    expect(lines[0]).toContain("withheld one step of the seat lane");
  });
});
