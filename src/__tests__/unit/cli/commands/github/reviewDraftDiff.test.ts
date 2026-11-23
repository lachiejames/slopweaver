import { describe, expect, it } from "vitest";

import { hunkExcerpt, reviewAnchorRefusals } from "../../../../../cli/commands/github/reviewDraftDiff.js";

/**
 * One file, two hunks. Head-side lines 10-16 are in the first hunk (13 and 14 added, old 13 removed), 40-42 in
 * the second (41 added); 17-39 are outside the diff.
 */
const PATCH = [
  "@@ -10,6 +10,7 @@ function a() {",
  " ten",
  " eleven",
  " twelve",
  "-old thirteen",
  "+new thirteen",
  "+new fourteen",
  " fifteen",
  " sixteen",
  "@@ -38,2 +40,3 @@ function b() {",
  " forty",
  "+forty-one",
  " forty-two",
].join("\n");

const FILES = [
  { patch: PATCH, path: "src/a.ts" },
  { patch: undefined, path: "assets/logo.png" },
];

describe("reviewAnchorRefusals", () => {
  it("lands a single line and a range that sit inside one hunk, on either an added or a context line", () => {
    expect(
      reviewAnchorRefusals({
        anchors: [
          { line: 14, path: "src/a.ts" },
          { line: 10, path: "src/a.ts" },
          { line: 15, path: "src/a.ts", startLine: 12 },
          { line: 41, path: "src/a.ts" },
        ],
        files: FILES,
      }),
    ).toEqual([]);
  });

  it("refuses every anchor GitHub would 422 the whole review over, in form order", () => {
    expect(
      reviewAnchorRefusals({
        anchors: [
          { line: 3, path: "src/unchanged.ts" },
          { line: 1, path: "assets/logo.png" },
          { line: 20, path: "src/a.ts" },
          { line: 41, path: "src/a.ts", startLine: 15 },
          { line: 13, path: "src/a.ts", startLine: 13 },
        ],
        files: FILES,
      }),
    ).toEqual([
      "src/unchanged.ts:3: the pull request does not change src/unchanged.ts",
      "assets/logo.png:1: GitHub shows no diff for assets/logo.png (binary or too large to comment on)",
      "src/a.ts:20: line 20 is not in the diff's head side, so GitHub cannot anchor it",
      "src/a.ts:15-41: line 17 is not in the diff's head side, so GitHub cannot anchor it",
      "src/a.ts:13-13: a range's startLine must be less than its line",
    ]);
  });
});

describe("hunkExcerpt", () => {
  it("draws the hunk header, three patch lines above the comment including a removal, and the line itself", () => {
    expect(hunkExcerpt({ anchor: { line: 14, path: "src/a.ts" }, patch: PATCH })).toEqual([
      { kind: "header", text: "@@ -10,6 +10,7 @@ function a() {" },
      { kind: "context", newLine: 12, oldLine: 12, text: "twelve" },
      { kind: "del", oldLine: 13, text: "old thirteen" },
      { kind: "add", newLine: 13, text: "new thirteen" },
      { kind: "add", newLine: 14, text: "new fourteen" },
    ]);
  });

  it("stops at its own hunk's header and never borrows lines from the hunk above", () => {
    expect(hunkExcerpt({ anchor: { line: 41, path: "src/a.ts" }, patch: PATCH })).toEqual([
      { kind: "header", text: "@@ -38,2 +40,3 @@ function b() {" },
      { kind: "context", newLine: 40, oldLine: 38, text: "forty" },
      { kind: "add", newLine: 41, text: "forty-one" },
    ]);
  });

  it("draws a range from three lines above its start through its end", () => {
    const excerpt = hunkExcerpt({ anchor: { line: 16, path: "src/a.ts", startLine: 15 }, patch: PATCH });

    expect(excerpt.map((line) => line.text)).toEqual([
      "@@ -10,6 +10,7 @@ function a() {",
      "old thirteen",
      "new thirteen",
      "new fourteen",
      "fifteen",
      "sixteen",
    ]);
  });
});
