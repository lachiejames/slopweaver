/*
 * The pure readers of a staged listing, pinned against literal listings: each stage's mode and sha per path, the
 * hidden edits counted against them, and the regular files a content read may compare.
 */
import { describe, expect, it } from "vitest";

import { countHiddenEdits, regularStaged, stagedBlobs } from "../../../../worktree/pruneGit.js";

describe("stagedBlobs and countHiddenEdits", () => {
  const listing = [
    "100644 aaa 0\tsame.json",
    "100644 bbb 0\tedited.json",
    "100644 c1 1\tconflict",
    "100644 c2 2\tconflict",
    "",
  ].join("\0");

  it("reads every stage's mode and sha per path", () => {
    const staged = stagedBlobs({ listing });

    expect(staged.get("same.json")).toEqual(["100644 aaa"]);
    expect(staged.get("conflict")).toEqual(["100644 c1", "100644 c2"]);
  });

  it("counts a mode-only change, where no byte moved", () => {
    const working = new Map<string, string | undefined>([["same.json", "100755 aaa"]]);

    expect(countHiddenEdits({ hidden: ["same.json"], staged: stagedBlobs({ listing }), working })).toBe(1);
  });

  it("counts an edit, a missing file, an unstaged path and a conflict, and nothing else", () => {
    const working = new Map<string, string | undefined>([
      ["same.json", "100644 aaa"],
      ["edited.json", "100644 zzz"],
      ["conflict", "100644 c1"],
      ["unlisted.json", "100644 ddd"],
    ]);

    expect(
      countHiddenEdits({
        hidden: ["same.json", "edited.json", "conflict", "unlisted.json", "gone.json"],
        staged: stagedBlobs({ listing }),
        working,
      }),
    ).toBe(4);
  });
});

describe("regularStaged", () => {
  it("keeps regular files, conflicted ones included, and leaves a symlink and a gitlink to status", () => {
    const staged = stagedBlobs({
      listing: [
        "100644 a1 0\tplain",
        "100755 b1 0\ttool",
        "120000 c1 0\tlink",
        "160000 d1 0\tsub",
        "100644 e1 1\tboth",
        "100644 e2 2\tboth",
        "",
      ].join("\0"),
    });

    expect(regularStaged({ staged })).toEqual(["plain", "tool", "both"]);
  });
});
