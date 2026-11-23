import { describe, expect, it } from "vitest";

import { checkFilteredVitestProbes, checkHandoverDoc } from "../../../handover/check.js";

describe("checkFilteredVitestProbes", () => {
  it("flags a filtered vitest run with no --passWithNoTests=false", () => {
    const findings = checkFilteredVitestProbes({
      line: "  - command: yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/handover",
      lineNumber: 7,
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(7);
    expect(findings[0]!.message).toContain("passWithNoTests");
  });

  it("passes a filtered vitest run that already carries --passWithNoTests=false", () => {
    const findings = checkFilteredVitestProbes({
      line: "  - command: yarn vitest run --config config/vitest/unit.ts --passWithNoTests=false src/__tests__/unit/handover",
      lineNumber: 7,
    });

    expect(findings).toEqual([]);
  });

  it("also accepts the space-separated spelling --passWithNoTests false", () => {
    const findings = checkFilteredVitestProbes({
      line: "  - command: yarn vitest run --config config/vitest/unit.ts --passWithNoTests false src/__tests__/unit/handover",
      lineNumber: 7,
    });

    expect(findings).toEqual([]);
  });

  it("stays silent on an unfiltered vitest run — no path filter, no risk of an empty match", () => {
    const findings = checkFilteredVitestProbes({
      line: "  - command: yarn test:unit",
      lineNumber: 1,
    });

    expect(findings).toEqual([]);
  });

  it("does not mistake the --config value for a path filter", () => {
    const findings = checkFilteredVitestProbes({
      line: "  - command: yarn vitest run --config config/vitest/unit.ts",
      lineNumber: 3,
    });

    expect(findings).toEqual([]);
  });

  it("stays silent on a line naming no vitest run at all", () => {
    expect(checkFilteredVitestProbes({ line: "  - command: yarn validate", lineNumber: 1 })).toEqual([]);
  });

  it("flags each filtered vitest run on one line, not just the first", () => {
    const findings = checkFilteredVitestProbes({
      line: "  - command: yarn vitest run --config config/vitest/unit.ts src/a.test.ts && yarn vitest run --config config/vitest/unit.ts src/b.test.ts",
      lineNumber: 1,
    });

    expect(findings.length).toBe(2);
  });
});

describe("checkHandoverDoc — filtered vitest probes", () => {
  it("flags a doneWhen command that filters vitest with no --passWithNoTests=false", () => {
    const findings = checkHandoverDoc({
      resolves: () => true,
      text: "  - command: yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/doesNotExist\n",
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("passWithNoTests");
  });

  it("passes a doneWhen command that filters vitest and carries --passWithNoTests=false", () => {
    const findings = checkHandoverDoc({
      resolves: () => true,
      text:
        "  - command: yarn vitest run --config config/vitest/unit.ts --passWithNoTests=false " +
        "src/__tests__/unit/doesNotExist\n",
    });

    expect(findings).toEqual([]);
  });
});
