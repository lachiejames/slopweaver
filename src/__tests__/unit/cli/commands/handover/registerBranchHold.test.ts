/**
 * `handover register --branch`'s warning (`cli/commands/handover/registerBranchHold.ts`): its words, and the two
 * absences that ask git nothing.
 */
import { describe, expect, it } from "vitest";

import { branchHoldWarning, registerBranchHold } from "../../../../../cli/commands/handover/registerBranchHold.js";

describe("branchHoldWarning", () => {
  it("names the branch, the tree, the holding row and the spawn that will refuse", () => {
    expect(
      branchHoldWarning({
        branch: "seat-a-pr-branch",
        holder: { path: "/repo/wt/seat-a", sessionId: "session-a", slug: "seat-a", via: "run" },
        slug: "finding-b",
        tree: "/repo/wt/seat-a",
      }),
    ).toBe(
      "handover register: --branch seat-a-pr-branch is checked out in /repo/wt/seat-a, which row seat-a holds — `cmux spawn finding-b` will refuse to open a second session there; registered anyway, and a row with no --branch is seated in a tree of its own",
    );
  });
});

describe("registerBranchHold", () => {
  it("warns about nothing when the row names no branch", () => {
    expect(registerBranchHold({ branch: undefined, home: "/no-home", repo: "/no-repo", slug: "finding-b" })).toBe(
      undefined,
    );
  });

  it("warns about nothing when the row records no checkout", () => {
    expect(
      registerBranchHold({ branch: "seat-a-pr-branch", home: "/no-home", repo: undefined, slug: "finding-b" }),
    ).toBe(undefined);
  });
});
