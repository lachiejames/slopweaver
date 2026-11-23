import { describe, expect, it } from "vitest";
import {
  stackPushCommitDriftReason,
  stackPushLineageReason,
  stackPushTreeDrift,
  stackPushTreeDriftReason,
  stackPushUnaskedUntracked,
  stackPushUnaskedUntrackedReason,
  TREE_DRIFT_PATH_UNAVAILABLE,
} from "../../../../../cli/commands/github/stackPushTree.js";

describe("stackPushUnaskedUntracked", () => {
  it("names an untracked node_modules symlink HEAD never touched", () => {
    expect(
      stackPushUnaskedUntracked({ heldNul: "", touchedNul: "src/a.ts\0", untrackedNul: "node_modules\0" }),
    ).toEqual(["node_modules"]);
  });

  it("passes an untracked path HEAD's own commit touched", () => {
    expect(
      stackPushUnaskedUntracked({ heldNul: "", touchedNul: "src/a.ts\0gone.ts\0", untrackedNul: "gone.ts\0" }),
    ).toEqual([]);
  });

  it("passes a new path the index holds, naming only the one nobody staged", () => {
    expect(
      stackPushUnaskedUntracked({ heldNul: "added.ts\0", touchedNul: "", untrackedNul: "added.ts\0node_modules\0" }),
    ).toEqual(["node_modules"]);
  });

  it("names a pinned path the index stopped holding, though HEAD carries it unchanged", () => {
    expect(
      stackPushUnaskedUntracked({
        heldNul: "feature.ts\0",
        touchedNul: "feature.ts\0",
        untrackedNul: "feature.ts\0victim.txt\0",
      }),
    ).toEqual(["victim.txt"]);
  });

  it("reports nothing when nothing is untracked", () => {
    expect(stackPushUnaskedUntracked({ heldNul: "", touchedNul: "src/a.ts\0", untrackedNul: "" })).toEqual([]);
  });

  it("names each path once, sorted, and keeps a filename carrying a newline whole", () => {
    expect(
      stackPushUnaskedUntracked({ heldNul: "", touchedNul: "", untrackedNul: "z.ts\0two\nlines.ts\0z.ts\0" }),
    ).toEqual(["two\nlines.ts", "z.ts"]);
  });
});

describe("stackPushUnaskedUntrackedReason", () => {
  it("names the paths, that nothing moved, and how to send one on purpose", () => {
    expect(stackPushUnaskedUntrackedReason({ paths: ["node_modules"] })).toBe(
      "the amend would add untracked path the pull request never touched (node_modules) — nothing was staged, " +
        "committed or sent. Stage one you mean to send with `git add -- <path>`; remove or ignore the rest, then " +
        "run stack push again",
    );
  });

  it("speaks of paths in the plural when there are several", () => {
    expect(stackPushUnaskedUntrackedReason({ paths: ["a", "b"] })).toContain("untracked paths the pull request");
  });
});

describe("stackPushTreeDrift", () => {
  it("reports nothing when the staged tree is the pinned one, whatever listing it is handed", () => {
    expect(stackPushTreeDrift({ nulPaths: "a.ts\0", pinnedTree: "t1", stagedTree: "t1" })).toEqual([]);
  });

  it("names every drifted path once, sorted", () => {
    expect(stackPushTreeDrift({ nulPaths: "b.ts\0a.ts\0b.ts\0", pinnedTree: "t1", stagedTree: "t2" })).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("keeps a filename carrying a newline as one path", () => {
    expect(stackPushTreeDrift({ nulPaths: "two\nlines.ts\0", pinnedTree: "t1", stagedTree: "t2" })).toEqual([
      "two\nlines.ts",
    ]);
  });

  it("still refuses when the trees differ but git listed no path", () => {
    expect(stackPushTreeDrift({ nulPaths: "", pinnedTree: "t1", stagedTree: "t2" })).toEqual([
      TREE_DRIFT_PATH_UNAVAILABLE,
    ]);
  });
});

describe("stackPushCommitDriftReason", () => {
  it("says the hook changed the commit, that nothing was sent, and that HEAD is already amended", () => {
    expect(stackPushCommitDriftReason({ paths: ["a.ts"] })).toBe(
      "a commit hook changed the tree inside the amend (a.ts), so the commit is not the tree stack push was run " +
        "over — nothing was sent. HEAD is already amended locally; read it with `git show --stat HEAD`, then run " +
        "stack push again to send it as it now stands",
    );
  });
});

describe("stackPushLineageReason", () => {
  it("names both commits, that nothing was sent, and that HEAD is already amended", () => {
    expect(stackPushLineageReason({ amendedSha: "a1", headSha: "h0" })).toBe(
      "the branch moved inside the amend, so a1 rewrote a commit other than h0 — nothing was sent. HEAD is " +
        "already amended locally; read it with `git show --stat HEAD`, then run stack push again to send it as " +
        "it now stands",
    );
  });
});

describe("stackPushTreeDriftReason", () => {
  it("names the paths, that nothing was sent, and the staged residue", () => {
    expect(stackPushTreeDriftReason({ paths: ["a.ts", "b.ts"] })).toBe(
      "the working tree changed while stack push ran (a.ts, b.ts), so the amend would have shipped an edit " +
        "nobody reviewed — nothing was committed or sent. `git add --all` has left the current tree staged; " +
        "read it with `git diff --cached`, then run stack push again over the tree you mean to send",
    );
  });
});
