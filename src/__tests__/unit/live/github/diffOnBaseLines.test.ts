import { describe, expect, it } from "vitest";

import { bareLine, lineEndingOf, linesOf, parsePatch } from "../../../../live/github/diffOnBaseLines.js";

describe("parsePatch", () => {
  it("reads each hunk's pre-image, post-image, deleted lines and header starts", () => {
    expect(parsePatch({ patch: "@@ -2,3 +2,3 @@\n a\n-b\n+B\n c" })).toEqual([
      { newStart: 2, oldStart: 2, post: ["a", "B", "c"], pre: ["a", "b", "c"], removed: ["b"] },
    ]);
  });

  it("marks the side a no-newline marker ends, and only that side", () => {
    const [hunk] = parsePatch({ patch: "@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+x" })!;

    expect([hunk!.pre[0] === "x", bareLine({ line: hunk!.pre[0]! }), hunk!.post]).toEqual([false, "x", ["x"]]);
  });

  it("refuses a body before any header, an unknown prefix, a short hunk, and a line after its side ended", () => {
    expect([
      parsePatch({ patch: " a" }),
      parsePatch({ patch: "@@ -1 +1 @@\n*a" }),
      parsePatch({ patch: "@@ -1,2 +1,2 @@\n a" }),
      parsePatch({ patch: "@@ -1,2 +1,2 @@\n a\n\\ No newline at end of file\n b" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses hunks whose headers cannot describe one edit of one file", () => {
    expect(parsePatch({ patch: "@@ -1 +1 @@\n-a\n+b\n@@ -1 +3 @@\n-c\n+d" })).toBe(undefined);
  });
});

describe("linesOf", () => {
  it("drops a final newline, reads CRLF as LF, and marks a last line with none", () => {
    const unterminated = linesOf({ text: "a\nb" });

    expect([linesOf({ text: "" }), linesOf({ text: "a\r\nb\r\n" }), unterminated.length]).toEqual([[], ["a", "b"], 2]);
    expect([unterminated[1] === "b", bareLine({ line: unterminated[1]! })]).toEqual([false, "b"]);
  });
});

describe("lineEndingOf", () => {
  it("names a text's line ending: LF, CRLF, both, or none", () => {
    expect([
      lineEndingOf({ text: "a\nb\n" }),
      lineEndingOf({ text: "a\r\nb\r\n" }),
      lineEndingOf({ text: "a\r\nb\n" }),
      lineEndingOf({ text: "a" }),
    ]).toEqual(["lf", "crlf", "mixed", "none"]);
  });
});
