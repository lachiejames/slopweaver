/*
 * The pull-request view's diff: every line numbered on the side GitHub numbers it, and a review comment's hunk cut
 * to the code above the comment. A patch drawn with the wrong numbers puts a review thread under the wrong line.
 */

import { describe, expect, it } from "vitest";

import { hunkTail, parseUnifiedDiff, placeByLine } from "../../lib/unifiedDiff";

describe("parseUnifiedDiff", () => {
  it("numbers a removal on the old side, an addition on the new, and context on both", () => {
    const patch = ["@@ -10,3 +10,3 @@ function a()", " keep", "-gone", "+came", " after"].join("\n");
    expect(parseUnifiedDiff({ patch })).toEqual([
      { kind: "hunk", text: "@@ -10,3 +10,3 @@ function a()" },
      { kind: "context", newNo: 10, oldNo: 10, text: "keep" },
      { kind: "del", oldNo: 11, text: "gone" },
      { kind: "add", newNo: 11, text: "came" },
      { kind: "context", newNo: 12, oldNo: 12, text: "after" },
    ]);
  });

  it("restarts the numbering at each hunk, and reads a header with no counts", () => {
    const patch = ["@@ -1 +1 @@", "-a", "+b", "@@ -40,2 +41,3 @@", " x", "+y"].join("\n");
    expect(parseUnifiedDiff({ patch })).toEqual([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "del", oldNo: 1, text: "a" },
      { kind: "add", newNo: 1, text: "b" },
      { kind: "hunk", text: "@@ -40,2 +41,3 @@" },
      { kind: "context", newNo: 41, oldNo: 40, text: "x" },
      { kind: "add", newNo: 42, text: "y" },
    ]);
  });

  it("keeps a no-newline marker and anything before the first hunk as a numberless note", () => {
    const patch = ["stray", "@@ -1 +1 @@", "+z", "\\ No newline at end of file"].join("\n");
    expect(parseUnifiedDiff({ patch })).toEqual([
      { kind: "note", text: "stray" },
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "add", newNo: 1, text: "z" },
      { kind: "note", text: "\\ No newline at end of file" },
    ]);
  });

  it("reads an empty patch as no rows", () => {
    expect(parseUnifiedDiff({ patch: "" })).toEqual([]);
  });
});

describe("placeByLine", () => {
  const rows = parseUnifiedDiff({ patch: ["@@ -1,2 +1,3 @@", " a", "-b", "+c", "+d"].join("\n") });

  it("hangs each item under the row that draws its new-side line, several on one line together", () => {
    const placed = placeByLine({
      items: [
        { item: "on a", line: 1, side: "RIGHT" },
        { item: "on c", line: 2, side: "RIGHT" },
        { item: "also on c", line: 2, side: "RIGHT" },
      ],
      rows,
    });
    expect([...placed.byRow.entries()]).toEqual([
      [1, ["on a"]],
      [3, ["on c", "also on c"]],
    ]);
    expect(placed.unshown).toEqual([]);
  });

  it("hangs a comment on a removed line under that line, counted in the old file", () => {
    const placed = placeByLine({
      items: [
        { item: "on b", line: 2, side: "LEFT" },
        { item: "on a, old side", line: 1, side: "LEFT" },
      ],
      rows,
    });
    expect([...placed.byRow.entries()]).toEqual([
      [2, ["on b"]],
      [1, ["on a, old side"]],
    ]);
  });

  it("keeps an item whose line the patch does not show on its side", () => {
    const placed = placeByLine({
      items: [
        { item: "far away", line: 90, side: "RIGHT" },
        { item: "past the old file", line: 3, side: "LEFT" },
      ],
      rows,
    });
    expect([...placed.byRow.entries()]).toEqual([]);
    expect(placed.unshown).toEqual(["far away", "past the old file"]);
  });
});

describe("hunkTail", () => {
  const hunk = ["@@ -1,4 +1,5 @@", " a", " b", "+c", " d"].join("\n");

  it("keeps the whole hunk, header included, when it is within the budget", () => {
    expect(hunkTail({ hunk, rows: 4 })).toHaveLength(5);
    expect(hunkTail({ hunk, rows: 4 })[0]).toEqual({ kind: "hunk", text: "@@ -1,4 +1,5 @@" });
  });

  it("keeps the last rows, the commented line last, and drops the header it cut from", () => {
    expect(hunkTail({ hunk, rows: 2 })).toEqual([
      { kind: "add", newNo: 3, text: "c" },
      { kind: "context", newNo: 4, oldNo: 3, text: "d" },
    ]);
  });
});
