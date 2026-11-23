import { describe, expect, it } from "vitest";
import { isSoleAuthorRepository } from "../../../../review/codeowners.js";

describe("isSoleAuthorRepository — the self-merging test", () => {
  it("is true when every rule names exactly the author", () => {
    const rules = [{ owners: ["@Author-Login"] }, { owners: ["@author-login"] }];
    expect(isSoleAuthorRepository({ authorLogin: "author-login", rules })).toBe(true);
  });

  it("is false when any rule names a team or a second person", () => {
    expect(isSoleAuthorRepository({ authorLogin: "author-login", rules: [{ owners: ["@org/eng"] }] })).toBe(false);
    expect(
      isSoleAuthorRepository({ authorLogin: "author-login", rules: [{ owners: ["@author-login", "@someone"] }] }),
    ).toBe(false);
  });

  it("is false when the author is not the owner, and false with no CODEOWNERS at all", () => {
    expect(isSoleAuthorRepository({ authorLogin: "someone-else", rules: [{ owners: ["@author-login"] }] })).toBe(false);
    expect(isSoleAuthorRepository({ authorLogin: "author-login", rules: [] })).toBe(false);
  });
});
