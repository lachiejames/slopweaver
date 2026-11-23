import { describe, expect, it } from "vitest";

import { checkHandoverDoc, checkProbeConfigPaths } from "../../../handover/check.js";

/** Resolves only the paths a fixture declares real, so every rule is testable without a filesystem. */
function exists({ real }: { real: readonly string[] }) {
  return ({ path }: { path: string }): boolean => real.includes(path);
}

describe("checkProbeConfigPaths", () => {
  it("passes a --config path that exists", () => {
    const findings = checkProbeConfigPaths({
      exists: exists({ real: ["config/vitest/unit.ts"] }),
      line: "  - command: yarn vitest run --config config/vitest/unit.ts src/a.test.ts",
      lineNumber: 4,
    });

    expect(findings).toEqual([]);
  });

  it("names a --config path that does not exist, with its line", () => {
    const findings = checkProbeConfigPaths({
      exists: exists({ real: [] }),
      line: "  - command: yarn vitest run --config vitest.unit.config.ts src/a.test.ts",
      lineNumber: 4,
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.line).toBe(4);
    expect(findings[0]!.message).toContain("vitest.unit.config.ts");
  });

  it("reports every --config path on one line, not just the first", () => {
    const findings = checkProbeConfigPaths({
      exists: exists({ real: [] }),
      line: "  - command: cmd --config a.ts && cmd2 --config b.ts",
      lineNumber: 1,
    });

    expect(findings.length).toBe(2);
    expect(findings.map((finding) => finding.message).join(" ")).toContain("a.ts");
    expect(findings.map((finding) => finding.message).join(" ")).toContain("b.ts");
  });

  it("stays silent on a line naming no --config flag at all", () => {
    expect(
      checkProbeConfigPaths({ exists: exists({ real: [] }), line: "  - command: yarn validate", lineNumber: 1 }),
    ).toEqual([]);
  });

  it("also accepts --config=path", () => {
    const findings = checkProbeConfigPaths({
      exists: exists({ real: [] }),
      line: "  - command: yarn vitest run --config=vitest.unit.config.ts",
      lineNumber: 1,
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("vitest.unit.config.ts");
  });
});

describe("checkHandoverDoc — --config existence", () => {
  it("flags a doneWhen command naming a --config path that does not exist", () => {
    const findings = checkHandoverDoc({
      configPathExists: exists({ real: [] }),
      resolves: () => true,
      text: '  - command: "yarn vitest run --config vitest.unit.config.ts --passWithNoTests=false src/a.test.ts"\n',
    });

    expect(findings.length).toBe(1);
    expect(findings[0]!.message).toContain("vitest.unit.config.ts");
  });

  it("passes a doneWhen command naming a --config path that exists", () => {
    const findings = checkHandoverDoc({
      configPathExists: exists({ real: ["config/vitest/unit.ts"] }),
      resolves: () => true,
      text: '  - command: "yarn vitest run --config config/vitest/unit.ts --passWithNoTests=false src/a.test.ts"\n',
    });

    expect(findings).toEqual([]);
  });

  it("defaults to no findings when the caller supplies no configPathExists seam", () => {
    expect(
      checkHandoverDoc({
        resolves: () => true,
        text: "  - command: yarn vitest run --config vitest.unit.config.ts\n",
      }),
    ).toEqual([]);
  });
});
