/**
 * What the `typescript-pin` gate prints and exits with: clean, unjudged input (a fact, not a refusal), and
 * a refusal carrying the four-line shape.
 */

import { describe, expect, it } from "vitest";

import { typescriptPinReport } from "../../../devLint/typescriptPinRun.js";

const MISMATCH = {
  kind: "direct-pin-mismatch",
  message: 'package.json devDependencies.typescript is "^7"',
  path: "package.json",
} as const;
const INVALID = {
  kind: "invalid-input",
  message: "yarn.lock: not a readable Yarn lockfile",
  path: "yarn.lock",
} as const;

describe("typescriptPinReport", () => {
  it("prints the clean line naming the subject counts and the version, and exits 0", () => {
    expect(typescriptPinReport({ findings: [], version: "7.1.0-beta" })).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "typescript-pin: clean (3 TypeScript manifests, 3 lockfiles; expected 7.1.0-beta)\n",
    });
  });

  it("reports unparseable input as unjudged, never as a refusal", () => {
    const report = typescriptPinReport({ findings: [INVALID], version: "6.0.3" });
    expect(report).toEqual({
      exitCode: 1,
      stderr: "  yarn.lock: not a readable Yarn lockfile\ntypescript-pin: 1 file(s) could not be parsed\n",
      stdout: "",
    });
  });

  it("refuses a pin finding with the gate's refusal after the listed findings", () => {
    const report = typescriptPinReport({ findings: [MISMATCH], version: "6.0.3" });
    expect(report.exitCode).toBe(1);
    expect(report.stdout).toBe("");
    expect(report.stderr.startsWith('  package.json devDependencies.typescript is "^7"\n')).toBe(true);
    expect(report.stderr).toContain("1 place(s) a TypeScript other than 6.0.3 is named or resolved");
    expect(report.stderr).toContain("There is no override for this lint gate at run time.");
  });
});
