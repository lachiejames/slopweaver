import { describe, expect, it } from "vitest";

import { firstReadHead, listedFiles } from "../../../../live/github/diffOnBaseListed.js";

/** One REST file-list entry diffed at head `abc`. */
const ENTRY = {
  contents_url: "https://api.github.com/repos/o/r/contents/a.ts?ref=abc",
  filename: "a.ts",
  patch: "@@ -1 +1 @@\n-a\n+b",
  sha: "blob1",
  status: "modified",
};

describe("listedFiles", () => {
  it("reads each entry with the head it was diffed at, whole when every count agrees", () => {
    const listed = listedFiles({
      data: { changedFiles: 1, files: { nodes: [ENTRY], pageInfo: { hasNextPage: false }, totalCount: 1 } },
    });
    expect(listed).toEqual({
      complete: true,
      files: [{ diffedAt: "abc", filename: "a.ts", patch: ENTRY.patch, sha: "blob1", status: "modified" }],
    });
  });

  it("calls the list partial when the pull request counts more changed files than it holds", () => {
    const listed = listedFiles({
      data: { changedFiles: 2, files: { nodes: [ENTRY], pageInfo: { hasNextPage: false }, totalCount: 1 } },
    });
    expect(listed!.complete).toBe(false);
  });

  it("refuses an entry whose patch is not a string", () => {
    const listed = listedFiles({
      data: { files: { nodes: [{ ...ENTRY, patch: 7 }], pageInfo: { hasNextPage: false }, totalCount: 1 } },
    });
    expect(listed).toBeUndefined();
  });
});

describe("firstReadHead", () => {
  it("names the last commit the first read carried", () => {
    const data = { commits: { nodes: [{ commit: { oid: "one" } }, { commit: { oid: "two" } }] } };
    expect(firstReadHead({ data })).toBe("two");
  });

  it("answers undefined for a read carrying no commits", () => {
    expect(firstReadHead({ data: {} })).toBeUndefined();
  });
});
