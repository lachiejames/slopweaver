import { describe, expect, it } from "vitest";

import { countMergeSubjects } from "../../../velocity/gitVelocity.js";

describe("countMergeSubjects", () => {
  it("counts subjects carrying a squash-merge PR number", () => {
    const subjects = ["fix(x): thing (#123)", "docs: readme", "feat(y): other (#456)"];

    expect(countMergeSubjects({ subjects })).toBe(2);
  });

  it("returns 0 for no subjects", () => {
    expect(countMergeSubjects({ subjects: [] })).toBe(0);
  });

  it("does not match a bare issue reference with no parens", () => {
    expect(countMergeSubjects({ subjects: ["fix: see #123"] })).toBe(0);
  });

  it("matches a PR number regardless of digit count", () => {
    expect(countMergeSubjects({ subjects: ["chore: bump (#7)", "chore: bump (#10234)"] })).toBe(2);
  });
});
