/**
 * The before-image a destructive description replacement has to print.
 *
 * These assert exact output rather than "contains a minus sign": the patch IS the consent artifact, so a
 * change in its shape is a change in what the operator was shown.
 */
import { describe, expect, it } from "vitest";

import { unifiedPatch } from "../../../lib/textDiff.js";

describe("unifiedPatch — identical sides produce nothing to consent to", () => {
  it("returns undefined when the two sides are the same", () => {
    expect(unifiedPatch({ after: "same", before: "same", what: "body" })).toBeUndefined();
  });

  it("returns undefined when both sides are empty", () => {
    expect(unifiedPatch({ after: "", before: "", what: "body" })).toBeUndefined();
  });

  it("does NOT return undefined when the live body is absent and the replacement is empty", () => {
    // Absent and empty are different facts, and the patch is where a reader would notice.
    expect(unifiedPatch({ after: "", before: undefined, what: "body" })).toBeDefined();
  });
});

describe("unifiedPatch — the labels say which side is live", () => {
  it("labels a present live body", () => {
    const patch = unifiedPatch({ after: "new", before: "old", what: "body" });
    expect(patch).toContain("--- body (live)");
    expect(patch).toContain("+++ body (replacement)");
  });

  it("labels an absent live body differently, so a reader can tell", () => {
    const patch = unifiedPatch({ after: "new", before: undefined, what: "body" });
    expect(patch).toContain("--- body (absent)");
  });
});

describe("unifiedPatch — the content of the change", () => {
  it("shows a one-line replacement exactly", () => {
    const patch = unifiedPatch({ after: "after\n", before: "before\n", what: "body" });
    expect(patch).toContain("-before");
    expect(patch).toContain("+after");
  });

  it("shows a pure insertion", () => {
    const patch = unifiedPatch({ after: "one\ntwo\n", before: "one\n", what: "body" });
    expect(patch).toContain("+two");
  });

  it("shows a pure deletion", () => {
    const patch = unifiedPatch({ after: "one\n", before: "one\ntwo\n", what: "body" });
    expect(patch).toContain("-two");
  });

  it("keeps whitespace significant, so a trailing-space change is visible", () => {
    const patch = unifiedPatch({ after: "text\n", before: "text \n", what: "body" });
    expect(patch).toContain("-text ");
  });

  it("marks a missing terminal newline rather than silently normalising it", () => {
    const patch = unifiedPatch({ after: "text", before: "text\n", what: "body" });
    expect(patch).toContain("\\ No newline at end of file");
  });

  it("names whatever noun the caller passed, so a title patch is not mistaken for a body one", () => {
    const patch = unifiedPatch({ after: "new title", before: "old title", what: "title" });
    expect(patch).toContain("--- title (live)");
  });
});
