import { describe, expect, it } from "vitest";
import {
  runTargetedTestsWith,
  type TargetedTestsDeps,
  type TargetedTestsPlan,
  type TargetedTestsPlanError,
  TargetedTestsPlanErrors,
} from "../../../../../cli/commands/dev/targetedTests.js";
import { DEV_TARGETED_TESTS_USAGE } from "../../../../../cli/commands/dev/targetedTestsUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

const PLAN: TargetedTestsPlan = {
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  changedCount: 1,
  selection: {
    projects: ["site"],
    tests: [{ path: "site/__tests__/unit/q.test.ts", reasons: ["changed-test"] }],
  },
  steps: [
    { argv: ["site/node_modules/.bin/tsc", "--noEmit"], label: "site tsc --noEmit" },
    { argv: ["node_modules/.bin/vitest", "run"], label: "vitest over 1 unit test file(s)" },
  ],
};

/** A recording harness: each effect a plain function writing into arrays the test reads back. */
function harness({
  plan = ok(PLAN),
  absent = [],
  statuses = [0, 0],
}: {
  plan?: Result<TargetedTestsPlan, TargetedTestsPlanError>;
  absent?: readonly string[];
  statuses?: readonly number[];
}): { deps: TargetedTestsDeps; out: string[]; error: string[]; ran: string[]; planned: () => number } {
  const out: string[] = [];
  const error: string[] = [];
  const ran: string[] = [];
  let planCalls = 0;
  const deps: TargetedTestsDeps = {
    error: (line) => {
      error.push(line);
    },
    out: (line) => {
      out.push(line);
    },
    plan: () => {
      planCalls += 1;
      return plan;
    },
    programPresent: (program) => !absent.includes(program),
    runStep: (step) => {
      ran.push(step.label);
      return statuses[ran.length - 1]!;
    },
  };
  return { deps, error, out, planned: () => planCalls, ran };
}

describe("runTargetedTestsWith", () => {
  it("prints the usage for --help without planning anything", () => {
    const h = harness({});
    expect(runTargetedTestsWith({ deps: h.deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(h.out).toEqual([DEV_TARGETED_TESTS_USAGE]);
    expect(h.planned()).toBe(0);
  });

  it("refuses an unknown flag with the usage, before any read", () => {
    const h = harness({});
    expect(runTargetedTestsWith({ deps: h.deps, rest: ["--base", "main"] })).toBe(EXIT_USAGE);
    expect(h.error.at(-1)).toBe(DEV_TARGETED_TESTS_USAGE);
    expect(h.planned()).toBe(0);
  });

  it("reports an unreadable state as an error and runs nothing", () => {
    const h = harness({ plan: err(TargetedTestsPlanErrors.notACheckout()) });
    expect(runTargetedTestsWith({ deps: h.deps, rest: [] })).toBe(EXIT_ERROR);
    expect(h.error).toEqual(["dev targeted-tests: not inside a git checkout, so there is no diff to target"]);
    expect(h.ran).toEqual([]);
  });

  it("names every missing program and runs nothing", () => {
    const h = harness({ absent: ["site/node_modules/.bin/tsc"] });
    expect(runTargetedTestsWith({ deps: h.deps, rest: [] })).toBe(EXIT_ERROR);
    expect(h.error).toEqual([
      "dev targeted-tests: site/node_modules/.bin/tsc not installed — run `yarn install` in that project, then re-run",
    ]);
    expect(h.ran).toEqual([]);
  });

  it("plans and prints but runs nothing on --dry-run", () => {
    const h = harness({});
    expect(runTargetedTestsWith({ deps: h.deps, rest: ["--dry-run"] })).toBe(EXIT_OK);
    expect(h.out.at(-1)).toBe("dev targeted-tests: --dry-run, so nothing ran");
    expect(h.ran).toEqual([]);
  });

  it("runs every step and passes when each is green", () => {
    const h = harness({});
    expect(runTargetedTestsWith({ deps: h.deps, rest: [] })).toBe(EXIT_OK);
    expect(h.ran).toEqual(["site tsc --noEmit", "vitest over 1 unit test file(s)"]);
    expect(h.out.at(-1)).toBe(
      "dev targeted-tests: PASS — 2 step(s) green; the lap still owns everything listed as not covered",
    );
  });

  it("stops at the first red step and names it", () => {
    const h = harness({ statuses: [2, 0] });
    expect(runTargetedTestsWith({ deps: h.deps, rest: [] })).toBe(EXIT_ERROR);
    expect(h.ran).toEqual(["site tsc --noEmit"]);
    expect(h.out.at(-1)).toBe("dev targeted-tests: FAIL — site tsc --noEmit exited 2; 1 later step(s) not run");
  });
});
