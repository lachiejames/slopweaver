/**
 * The chained-not-natively-stacked relation — the one function every door and the audit verb decide from.
 */
import { describe, expect, it } from "vitest";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";

import {
  type AuditPr,
  chainDoorRefusalLines,
  chainKindFor,
  chainParentFor,
  chainViolationsIn,
  githubStackAuditReportLines,
  parseGithubStackAuditArgs,
  STACK_AUDIT_TRUNCATED_LINE,
  stackAuditExitCode,
} from "../../../../../cli/commands/github/stackAuditCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** One open pull request, with every field the relation reads. */
function pr(overrides: Partial<AuditPr> = {}): AuditPr {
  return {
    baseRef: "main",
    baseRepoFullName: "o/r",
    headRef: "feature",
    headRepoFullName: "o/r",
    htmlUrl: "https://github.com/o/r/pull/1",
    number: 1,
    stackNumber: undefined,
    yours: true,
    ...overrides,
  };
}

describe("chainKindFor", () => {
  it("names neither-stacked when no membership exists on either side", () => {
    expect(chainKindFor({ childStackNumber: undefined, parentStackNumber: undefined })).toBe("neither-stacked");
  });

  it("names child-unstacked when the parent is in a stack the child has not joined", () => {
    expect(chainKindFor({ childStackNumber: undefined, parentStackNumber: 16958 })).toBe("child-unstacked");
  });

  it("names parent-unstacked when only the child carries a membership", () => {
    expect(chainKindFor({ childStackNumber: 12, parentStackNumber: undefined })).toBe("parent-unstacked");
  });

  it("names different-stacks when both are stacked, apart", () => {
    expect(chainKindFor({ childStackNumber: 12, parentStackNumber: 13 })).toBe("different-stacks");
  });

  it("reports nothing at all when both sit in the same native stack", () => {
    expect(chainKindFor({ childStackNumber: 16958, parentStackNumber: 16958 })).toBe(undefined);
  });
});

describe("chainParentFor", () => {
  it("finds the open pull request whose head branch is the base", () => {
    const parent = pr({ headRef: "lower", number: 5 });
    const found = chainParentFor({ baseRef: "lower", baseRepoFullName: "o/r", openPrs: [parent] });
    expect(found?.number).toBe(5);
  });

  it("never pairs a fork branch that merely shares a name with the base", () => {
    const fork = pr({ headRef: "shared", headRepoFullName: "someone/r", number: 5 });
    expect(chainParentFor({ baseRef: "shared", baseRepoFullName: "o/r", openPrs: [fork] })).toBe(undefined);
  });

  it("never reads a pull request as its own parent", () => {
    const self = pr({ baseRef: "feature", headRef: "feature", number: 7 });
    expect(chainParentFor({ baseRef: "feature", baseRepoFullName: "o/r", excludeNumber: 7, openPrs: [self] })).toBe(
      undefined,
    );
  });

  it("answers undefined when the base is nobody's open head branch", () => {
    expect(chainParentFor({ baseRef: "main", baseRepoFullName: "o/r", openPrs: [pr()] })).toBe(undefined);
  });
});

describe("chainViolationsIn", () => {
  it("reports a chained pair that carries no native stack at all", () => {
    const parent = pr({ headRef: "lower", number: 16672 });
    const child = pr({ baseRef: "lower", headRef: "upper", number: 16676 });
    const violations = chainViolationsIn({ openPrs: [parent, child] });
    expect(violations.length).toBe(1);
    expect(violations[0]!.child.number).toBe(16676);
    expect(violations[0]!.parent.number).toBe(16672);
    expect(violations[0]!.kind).toBe("neither-stacked");
  });

  it("reports a child that has not joined the native stack its parent is already in", () => {
    const parent = pr({ headRef: "lower", number: 16339, stackNumber: 16958 });
    const child = pr({ baseRef: "lower", headRef: "upper", number: 16355 });
    const violations = chainViolationsIn({ openPrs: [parent, child] });
    expect(violations.length).toBe(1);
    expect(violations[0]!.kind).toBe("child-unstacked");
  });

  it("reports nothing when the whole chain is one native stack", () => {
    const bottom = pr({ headRef: "a", number: 1, stackNumber: 99 });
    const middle = pr({ baseRef: "a", headRef: "b", number: 2, stackNumber: 99 });
    const top = pr({ baseRef: "b", headRef: "c", number: 3, stackNumber: 99 });
    expect(chainViolationsIn({ openPrs: [bottom, middle, top] })).toEqual([]);
  });

  it("reports nothing for pull requests that all target the default branch", () => {
    expect(chainViolationsIn({ openPrs: [pr({ number: 1 }), pr({ headRef: "other", number: 2 })] })).toEqual([]);
  });

  it("reports every link of a long chain separately, so each one names its own repair", () => {
    const bottom = pr({ headRef: "a", number: 1 });
    const middle = pr({ baseRef: "a", headRef: "b", number: 2 });
    const top = pr({ baseRef: "b", headRef: "c", number: 3 });
    const violations = chainViolationsIn({ openPrs: [bottom, middle, top] });
    expect(violations.map((violation) => violation.child.number)).toEqual([2, 3]);
  });
});

describe("githubStackAuditReportLines", () => {
  it("names the scanned count as well as the zero, so a clean report is not an empty one", () => {
    expect(githubStackAuditReportLines({ openPrCount: 390, repo: "o/r", truncated: false, violations: [] })).toEqual([
      "o/r: 390 open pull request(s) scanned, 0 chained without a native stack",
      "every open chain in this repository is an actual GitHub native stack",
    ]);
  });

  it("names the stack a child must join, and marks another author's as not ours to adopt", () => {
    const parent = pr({ headRef: "lower", number: 16339, stackNumber: 16958, yours: false });
    const child = pr({ baseRef: "lower", headRef: "upper", number: 16355, yours: false });
    const lines = githubStackAuditReportLines({
      openPrCount: 2,
      repo: "o/r",
      truncated: false,
      violations: chainViolationsIn({ openPrs: [parent, child] }),
    });
    expect(lines[0]).toBe("o/r: 2 open pull request(s) scanned, 1 chained without a native stack");
    expect(lines[1]).toBe("0 of them involve a pull request this token authored");
    expect(lines[3]).toBe(
      "  #16355 (upper) is based on #16339 (lower) — child-unstacked: child stack none, parent stack #16958",
    );
    expect(lines[5]).toBe(
      "    another author's — report it, do not adopt it: check out upper and run `slopweaver github stack " +
        "adopt --pr 16355` (add --register-only if its branch has drifted past a one-commit replay) — it " +
        "must join native stack #16958",
    );
  });
});

describe("a walk the page cap cut short — fails closed", () => {
  it("never prints the every-chain sentence over a partial list", () => {
    expect(githubStackAuditReportLines({ openPrCount: 500, repo: "o/r", truncated: true, violations: [] })).toEqual([
      "o/r: 500 open pull request(s) scanned, 0 chained without a native stack",
      STACK_AUDIT_TRUNCATED_LINE,
    ]);
  });

  it("says the scan was partial above the violations it did find", () => {
    const parent = pr({ headRef: "lower", number: 10 });
    const child = pr({ baseRef: "lower", headRef: "upper", number: 11 });
    const lines = githubStackAuditReportLines({
      openPrCount: 2,
      repo: "o/r",
      truncated: true,
      violations: chainViolationsIn({ openPrs: [parent, child] }),
    });
    expect(lines.slice(0, 3)).toEqual([
      "o/r: 2 open pull request(s) scanned, 1 chained without a native stack",
      STACK_AUDIT_TRUNCATED_LINE,
      "1 of them involve a pull request this token authored",
    ]);
  });

  it("fails --check on a partial walk with zero violations", () => {
    expect(stackAuditExitCode({ check: true, truncated: true, violationCount: 0 })).toBe(1);
  });

  it("passes --check only on a whole walk with zero violations", () => {
    expect(stackAuditExitCode({ check: true, truncated: false, violationCount: 0 })).toBe(0);
  });

  it("fails --check on a violation over a whole walk", () => {
    expect(stackAuditExitCode({ check: true, truncated: false, violationCount: 1 })).toBe(1);
  });

  it("reports without --check, partial or not", () => {
    expect(stackAuditExitCode({ check: false, truncated: true, violationCount: 3 })).toBe(0);
  });
});

describe("chainDoorRefusalLines", () => {
  it("names the verb being refused, the parent, and the stack it must join", () => {
    const lines = chainDoorRefusalLines({
      base: "lower",
      parent: pr({ headRef: "lower", number: 16339, stackNumber: 16958 }),
      verb: "retargeting #16355 onto lower",
    });
    expect(lines[0]).toBe(
      "refused: retargeting #16355 onto lower would leave a chained pull request that GitHub does not know is a stack.",
    );
    expect(lines[2]).toBe(
      "  Base lower is the head branch of open pull request #16339 (https://github.com/o/r/pull/1), and",
    );
    expect(lines[3]).toBe("  it must join native stack #16958.");
  });

  it("says a stack has to be formed when the parent carries no membership either", () => {
    const lines = chainDoorRefusalLines({
      base: "lower",
      parent: pr({ headRef: "lower", number: 16672 }),
      verb: "pushing upper",
    });
    expect(lines[3]).toBe("  there is no native stack yet, so one must be formed from the pair.");
  });
});

describe("parseGithubStackAuditArgs", () => {
  it("parses the whole invocation", () => {
    expect(unwrap(parseGithubStackAuditArgs({ argv: ["--repo", "o/r", "--check", "--json", "--mine"] }))).toEqual({
      check: true,
      home: undefined,
      json: true,
      mine: true,
      owner: "o",
      repo: "r",
    });
  });

  it("defaults every flag off", () => {
    expect(unwrap(parseGithubStackAuditArgs({ argv: ["--repo", "o/r"] }))).toEqual({
      check: false,
      home: undefined,
      json: false,
      mine: false,
      owner: "o",
      repo: "r",
    });
  });

  it("requires --repo", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubStackAuditArgs({ argv: [] })) })).toEqual([
      "--repo owner/name is required",
    ]);
  });

  it("refuses a slug that is not owner/name", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubStackAuditArgs({ argv: ["--repo", "just-a-name"] })) }),
    ).toEqual(['--repo must be owner/name; "just-a-name" is not']);
  });
});
