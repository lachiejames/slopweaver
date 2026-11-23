import { describe, expect, it } from "vitest";
import { parseWorkingTreeStatus, prePushWorkingTreeRefusal } from "../../../admit/prePushWorkingTree.js";

/** A real `git status --porcelain` body: one staged add, one unstaged edit, one untracked file. */
const MIXED = " M src/lib/paging.ts\nA  src/lib/new.ts\n?? scratch/notes.txt\n";

describe("parseWorkingTreeStatus", () => {
  it("reads nothing from a clean tree, with or without a trailing newline", () => {
    expect(parseWorkingTreeStatus({ statusPorcelain: "" })).toEqual([]);
    expect(parseWorkingTreeStatus({ statusPorcelain: "\n" })).toEqual([]);
  });

  it("keeps git's own two-letter code beside each path, in git's order", () => {
    expect(parseWorkingTreeStatus({ statusPorcelain: MIXED })).toEqual([
      { code: " M", path: "src/lib/paging.ts" },
      { code: "A ", path: "src/lib/new.ts" },
      { code: "??", path: "scratch/notes.txt" },
    ]);
  });

  it("reports a rename by its destination — the path a commit would have to carry", () => {
    expect(parseWorkingTreeStatus({ statusPorcelain: "R  src/old.ts -> src/new.ts\n" })).toEqual([
      { code: "R ", path: "src/new.ts" },
    ]);
  });

  it("keeps a path that contains a space whole", () => {
    expect(parseWorkingTreeStatus({ statusPorcelain: "?? docs/some notes.md\n" })).toEqual([
      { code: "??", path: "docs/some notes.md" },
    ]);
  });

  it("reads an unmerged path as the change it is", () => {
    expect(parseWorkingTreeStatus({ statusPorcelain: "UU src/conflict.ts\n" })).toEqual([
      { code: "UU", path: "src/conflict.ts" },
    ]);
  });
});

describe("prePushWorkingTreeRefusal", () => {
  it("permits a clean tree, which is the only state a gate's green speaks for", () => {
    expect(prePushWorkingTreeRefusal({ statusPorcelain: "" })).toEqual([]);
  });

  it("names every modified and untracked path, and says which subject the push has", () => {
    expect(prePushWorkingTreeRefusal({ statusPorcelain: MIXED })).toEqual([
      "the working tree differs from HEAD, so a pre-push gate would judge files this push does not send (3 path(s)):",
      "   M src/lib/paging.ts",
      "  A  src/lib/new.ts",
      "  ?? scratch/notes.txt",
      "commit or stash them, then push again — git push sends the commit, never the tree.",
    ]);
  });

  it("names ten paths and counts the rest, so a wholesale change still reads as a reason", () => {
    const statusPorcelain = Array.from({ length: 12 }, (_, index) => ` M src/f${String(index)}.ts`).join("\n");
    const lines = prePushWorkingTreeRefusal({ statusPorcelain });
    expect(lines[0]).toBe(
      "the working tree differs from HEAD, so a pre-push gate would judge files this push does not send (12 path(s)):",
    );
    expect(lines.slice(1, 11)).toEqual([
      "   M src/f0.ts",
      "   M src/f1.ts",
      "   M src/f2.ts",
      "   M src/f3.ts",
      "   M src/f4.ts",
      "   M src/f5.ts",
      "   M src/f6.ts",
      "   M src/f7.ts",
      "   M src/f8.ts",
      "   M src/f9.ts",
    ]);
    expect(lines[11]).toBe("  … and 2 more");
    expect(lines).toHaveLength(13);
  });
});
