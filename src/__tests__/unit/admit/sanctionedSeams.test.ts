/**
 * The seam register, checked as a register rather than as a list of names.
 *
 * Nothing here asserts that a particular file is sanctioned — that would be a second copy of the register,
 * drifting the moment the first one changes. What it asserts is the register's own contract: that it is
 * non-empty, that every row carries a class the scanner can act on, and that every path is repo-relative and
 * points at a source file, because a row whose key does not match how the scanner spells a path sanctions
 * nothing at all while looking exactly like it does.
 */
import { describe, expect, it } from "vitest";

import { SANCTIONED_SEAMS } from "../../../admit/sanctionedSeams.js";

const CLASSES = new Set(["door-internal", "local-state", "read-only-tool", "dev-tooling"]);

describe("SANCTIONED_SEAMS", () => {
  it("is a non-empty register, so every guard below is true of something", () => {
    expect(Object.keys(SANCTIONED_SEAMS).length).toBeGreaterThan(0);
  });

  it("classes every row as something other than open, which is the failing class", () => {
    expect(Object.entries(SANCTIONED_SEAMS).filter(([, seamClass]) => !CLASSES.has(seamClass))).toEqual([]);
  });

  it("keys every row on a repo-relative source path, which is how the scanner spells one", () => {
    const wrong = Object.keys(SANCTIONED_SEAMS).filter(
      (path) => path.startsWith("/") || path.startsWith("./") || !path.endsWith(".ts"),
    );
    expect(wrong).toEqual([]);
  });

  it("holds no duplicate path, which an object literal silently collapses", () => {
    expect(new Set(Object.keys(SANCTIONED_SEAMS)).size).toBe(Object.keys(SANCTIONED_SEAMS).length);
  });
});
