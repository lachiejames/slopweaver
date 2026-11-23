/**
 * `slack draft record --act` and `--row`, read on their own: the badge a card draws and the board row it files
 * under, neither of which the owner's approval binds.
 */
import { describe, expect, it } from "vitest";

import { actProblem, recordActOf, rowProblems } from "../../../../../cli/commands/slack/draftCardFields.js";

describe("recordActOf", () => {
  it("leaves an absent --act undeclared, so the card draws no badge", () => {
    expect(recordActOf({ value: undefined })).toBeUndefined();
  });

  it("reads each act the card can badge", () => {
    expect(["reply", "bump", "review-ask"].map((value) => recordActOf({ value }))).toEqual([
      "reply",
      "bump",
      "review-ask",
    ]);
  });

  it("reads a value outside the set as invalid, question included", () => {
    expect([recordActOf({ value: "chase" }), recordActOf({ value: "question" })]).toEqual(["invalid", "invalid"]);
  });
});

describe("actProblem", () => {
  it("names the set", () => {
    expect(actProblem({ value: "chase" })).toBe("slack draft record --act must be reply, bump, review-ask, got chase");
  });

  it("says why a question is not a draft's act", () => {
    expect(actProblem({ value: "question" })).toBe(
      "slack draft record --act must be reply, bump, review-ask, got question: a question is the badge of a board ask row, where they are the one asked — a draft asking somebody is a reply or a bump",
    );
  });
});

describe("rowProblems", () => {
  it("finds nothing in an absent --row or a plain slug", () => {
    expect([...rowProblems({ row: undefined }), ...rowProblems({ row: "thread-chase-daily" })]).toEqual([]);
  });

  it("refuses a path, quoting what was typed", () => {
    expect(rowProblems({ row: "../escape" })).toEqual([
      'slack draft record --row must be a board row\'s slug, got "../escape"',
    ]);
  });

  it("refuses an empty --row", () => {
    expect(rowProblems({ row: "" })).toEqual(['slack draft record --row must be a board row\'s slug, got ""']);
  });
});
