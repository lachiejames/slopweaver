import { describe, expect, it } from "vitest";
import {
  parseDevTargetedTestsArgs,
  targetedTestsNotCoveredLines,
  targetedTestsPlanLines,
  targetedTestsVerdictLine,
} from "../../../../../cli/commands/dev/targetedTestsCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { TARGETED_TESTS_NOT_COVERED } from "../../../../../testLanes/targetedTests.js";

const VITEST = { argv: ["node_modules/.bin/vitest", "run"], label: "vitest over 1 unit test file(s)" };
const SITE = { argv: ["site/node_modules/.bin/tsc", "--noEmit"], label: "site tsc --noEmit" };

describe("parseDevTargetedTestsArgs", () => {
  it("reads --dry-run", () => {
    expect(unwrap(parseDevTargetedTestsArgs({ rest: ["--dry-run"] })).values["dry-run"]).toBe(true);
  });

  it("refuses a positional and an unknown flag", () => {
    expect(unwrapErr(parseDevTargetedTestsArgs({ rest: ["src/a.ts"] })).join(" ")).toContain("src/a.ts");
    expect(unwrapErr(parseDevTargetedTestsArgs({ rest: ["--base", "abc"] })).join(" ")).toContain("--base");
  });
});

describe("targetedTestsPlanLines", () => {
  it("prints the base, each diff-reached test with its reasons, the sweep as a count, each step and the not-covered list", () => {
    const lines = targetedTestsPlanLines({
      baseSha: "a".repeat(40),
      changedCount: 3,
      selection: {
        projects: ["site"],
        tests: [
          { path: "src/__tests__/unit/cli/helpTruth.test.ts", reasons: ["changed-test", "registry-sweep"] },
          { path: "src/__tests__/unit/devLint/namingDoctrine.test.ts", reasons: ["registry-sweep"] },
        ],
      },
      steps: [SITE, VITEST],
    });
    expect(lines).toEqual([
      `dev targeted-tests: base ${"a".repeat(40)} (merge-base of HEAD and origin/main), 3 changed path(s)`,
      "selected 2 unit test file(s): 1 the diff reached, 1 more by the fixed registry sweep alone",
      "  src/__tests__/unit/cli/helpTruth.test.ts — changed-test, registry-sweep",
      "steps, in order, each stopping the run when red:",
      "  site tsc --noEmit: site/node_modules/.bin/tsc --noEmit",
      "  vitest over 1 unit test file(s): node_modules/.bin/vitest run",
      ...targetedTestsNotCoveredLines(),
    ]);
  });

  it("names the root typecheck among what it does not cover", () => {
    expect(TARGETED_TESTS_NOT_COVERED.length).toBe(6);
    expect(targetedTestsNotCoveredLines()[1]).toContain("root typecheck");
  });
});

describe("targetedTestsVerdictLine", () => {
  it("reads PASS when every step ran green", () => {
    expect(targetedTestsVerdictLine({ failed: undefined, ran: 2, status: 0, total: 2 })).toBe(
      "dev targeted-tests: PASS — 2 step(s) green; the lap still owns everything listed as not covered",
    );
  });

  it("names the red step and how many later steps did not run", () => {
    expect(targetedTestsVerdictLine({ failed: SITE, ran: 1, status: 2, total: 2 })).toBe(
      "dev targeted-tests: FAIL — site tsc --noEmit exited 2; 1 later step(s) not run",
    );
    expect(targetedTestsVerdictLine({ failed: VITEST, ran: 2, status: 1, total: 2 })).toBe(
      "dev targeted-tests: FAIL — vitest over 1 unit test file(s) exited 1",
    );
  });
});
