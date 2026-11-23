import { describe, expect, it } from "vitest";

import { checkBareSubVerbSuccessProbes, checkHandoverDoc } from "../../../handover/check.js";

describe("checkBareSubVerbSuccessProbes", () => {
  it("flags a bare success-gated sub-verb invocation with no output assertion", () => {
    const findings = checkBareSubVerbSuccessProbes({
      line: '  - command: "slopweaver github stack remove --pr 16338 --dry-run"',
      lineNumber: 9,
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(9);
    expect(findings[0]!.message).toContain("gated on exit code alone");
  });

  it("flags an explicit -eq 0 success check the same way", () => {
    const findings = checkBareSubVerbSuccessProbes({
      line: '  - command: "./bin/slopweaver github stack remove --pr 16338 --dry-run; test $? -eq 0"',
      lineNumber: 1,
    });

    expect(findings.length).toBe(1);
  });

  it("passes a probe that checks REFUSAL instead of success", () => {
    const findings = checkBareSubVerbSuccessProbes({
      line: '  - command: "./bin/slopweaver github stack definitely-not-a-verb --dry-run >/dev/null 2>&1; test $? -ne 0"',
      lineNumber: 1,
    });

    expect(findings).toEqual([]);
  });

  it("passes a probe that asserts on the printed output", () => {
    const findings = checkBareSubVerbSuccessProbes({
      line: "  - command: \"slopweaver github stack remove --pr 16338 --dry-run | grep -q 'would remove'\"",
      lineNumber: 1,
    });

    expect(findings).toEqual([]);
  });

  it("stays silent on a command line naming no sub-verb invocation at all", () => {
    expect(checkBareSubVerbSuccessProbes({ line: "  - command: yarn validate", lineNumber: 1 })).toEqual([]);
  });

  it("stays silent on prose that merely mentions a slopweaver command outside a `command:` field", () => {
    const findings = checkBareSubVerbSuccessProbes({
      line: "Measured 30 Aug 2026: `slopweaver github stack remove --pr 16338 --dry-run` printed usage and exited 0.",
      lineNumber: 3,
    });

    expect(findings).toEqual([]);
  });
});

describe("checkHandoverDoc — bare sub-verb success probes", () => {
  it("flags a doneWhen command that is a bare success-gated sub-verb invocation", () => {
    const findings = checkHandoverDoc({
      resolves: () => true,
      text: '  - command: "slopweaver github stack remove --pr 16338 --dry-run"\n',
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("gated on exit code alone");
  });

  it("passes a doneWhen command that checks refusal by exit code", () => {
    const findings = checkHandoverDoc({
      resolves: () => true,
      text: '  - command: "slopweaver github stack definitely-not-a-verb --dry-run >/dev/null 2>&1; test $? -ne 0"\n',
    });

    expect(findings).toEqual([]);
  });
});
