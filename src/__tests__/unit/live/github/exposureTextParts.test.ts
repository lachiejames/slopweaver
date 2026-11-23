/**
 * The shared readers the exposure text extractors build on: string fields as texts, and the locator parts that
 * answer `?` rather than fail when GitHub's answer lacks a field.
 */
import { describe, expect, it } from "vitest";

import { idOf, paramOf, recordsAt, stringPart, tailOf, textsAt } from "../../../../live/github/exposureTextParts.js";

describe("textsAt", () => {
  it("keeps each non-empty string field, named by its dotted path, and drops empty and missing ones", () => {
    const item = { body: "", head: { ref: "feature" }, title: "Fix it" };
    expect(
      textsAt({
        fields: [["title"], ["body"], ["head", "ref"], ["missing"]],
        item,
        locator: "pull #1",
        surface: "pull-requests",
      }),
    ).toEqual([
      { field: "title", locator: "pull #1", surface: "pull-requests", text: "Fix it" },
      { field: "head.ref", locator: "pull #1", surface: "pull-requests", text: "feature" },
    ]);
  });
});

describe("the locator parts", () => {
  it("reads what the item carries", () => {
    expect(stringPart({ item: { sha: "abc" }, path: ["sha"] })).toBe("abc");
    expect(idOf({ item: { id: 42 } })).toBe("42");
    expect(
      tailOf({ item: { issue_url: "https://api.github.com/repos/acme/widgets/issues/7" }, key: "issue_url" }),
    ).toBe("7");
    expect(paramOf({ key: "ref", params: { ref: "c1" } })).toBe("c1");
    expect(recordsAt({ item: { steps: [1, 2] }, key: "steps" })).toEqual([1, 2]);
  });

  it("answers ? or nothing when the field is absent", () => {
    expect(stringPart({ item: {}, path: ["sha"] })).toBe("?");
    expect(idOf({ item: { id: "not a number" } })).toBe("?");
    expect(tailOf({ item: {}, key: "issue_url" })).toBe("?");
    expect(paramOf({ key: "ref", params: {} })).toBe("?");
    expect(recordsAt({ item: { steps: "none" }, key: "steps" })).toEqual([]);
  });
});
