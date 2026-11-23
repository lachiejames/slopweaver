import { describe, expect, it } from "vitest";

import { sameTree, shortDigest, treeDrift, treeFingerprint } from "../../../codex/fingerprint.js";

const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const OTHER_HEAD = "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("treeFingerprint", () => {
  it("is stable for the same inputs", () => {
    const a = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `t-${HEAD}` });
    const b = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(a.digest).toBe(b.digest);
  });

  it("reports a clean tree as zero dirty bytes and keeps HEAD alongside the digest", () => {
    const clean = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(clean.dirtyBytes).toBe(0);
    expect(clean.headSha).toBe(HEAD);
    expect(clean.digest.length).toBe(64);
  });

  it("moves when HEAD moves", () => {
    const before = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `t-${HEAD}` });
    const after = treeFingerprint({ dirtyPatch: "", headSha: OTHER_HEAD, treeSha: `t-${OTHER_HEAD}` });
    expect(before.digest === after.digest).toBe(false);
  });

  // The measured failure this exists for: during the PR6 build the tree changed for an hour with no commit.
  it("moves when the working tree changes under an unchanged HEAD", () => {
    const before = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `t-${HEAD}` });
    const after = treeFingerprint({ dirtyPatch: "diff --git a/x b/x\n+edited\n", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(after.headSha).toBe(before.headSha);
    expect(before.digest === after.digest).toBe(false);
  });

  it("counts dirty patch bytes rather than characters", () => {
    // "é" is two bytes in UTF-8 and one JS character; a byte count is what a reader compares against a diff.
    const fp = treeFingerprint({ dirtyPatch: "é", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(fp.dirtyBytes).toBe(2);
  });

  /**
   * The separator's actual job, pinned by the case that has no separator character in it at all.
   *
   * The earlier version of this test compared `("A", "B")` against `("A B", "")`, which passes even with NO
   * separator — the space in `"A B"` did the separating. So it went green while the implementation's
   * separator was silently removed. This is the honest case: concatenated, both inputs are `"AB"`.
   */
  it("does not collide when the boundary between the two inputs shifts", () => {
    const split = treeFingerprint({ dirtyPatch: "B", headSha: "A", treeSha: `t-${"A"}` });
    const joined = treeFingerprint({ dirtyPatch: "", headSha: "AB", treeSha: `t-${"AB"}` });
    expect(split.digest === joined.digest).toBe(false);
  });

  it("does not collide when the patch itself opens with the separator", () => {
    const a = treeFingerprint({ dirtyPatch: "\nB", headSha: "A", treeSha: `t-${"A"}` });
    const b = treeFingerprint({ dirtyPatch: "B", headSha: "A\n", treeSha: `t-${"A\n"}` });
    expect(a.digest === b.digest).toBe(false);
  });
});

describe("sameTree", () => {
  it("is true for two captures of an unchanged tree", () => {
    const before = treeFingerprint({ dirtyPatch: "p", headSha: HEAD, treeSha: `t-${HEAD}` });
    const after = treeFingerprint({ dirtyPatch: "p", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(sameTree({ after, before })).toBe(true);
  });

  it("is false once anything moves", () => {
    const before = treeFingerprint({ dirtyPatch: "p", headSha: HEAD, treeSha: `t-${HEAD}` });
    const after = treeFingerprint({ dirtyPatch: "q", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(sameTree({ after, before })).toBe(false);
  });
});

describe("treeDrift", () => {
  it("returns undefined when nothing moved", () => {
    const before = treeFingerprint({ dirtyPatch: "p", headSha: HEAD, treeSha: `t-${HEAD}` });
    const after = treeFingerprint({ dirtyPatch: "p", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(treeDrift({ after, before })).toBeUndefined();
  });

  it("names a commit that CHANGED THE FILES mid-pass", () => {
    const before = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `t-${HEAD}` });
    const after = treeFingerprint({ dirtyPatch: "", headSha: OTHER_HEAD, treeSha: `t-${OTHER_HEAD}` });
    expect(treeDrift({ after, before })).toBe("the committed tree changed (HEAD 06e12d9aa1b2 → 2148718aa1b2)");
  });

  /**
   * A squash, amend or rebase moves HEAD without touching a single file, and this repo REQUIRES one commit
   * off the base — so hashing the commit made the mandated workflow invalidate every pass right before the
   * PR was opened. Same tree object, same digest, no drift.
   */
  it("does not drift when only the commit changed and the files did not", () => {
    const before = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: "shared-tree" });
    const afterSquash = treeFingerprint({ dirtyPatch: "", headSha: OTHER_HEAD, treeSha: "shared-tree" });

    expect(treeDrift({ after: afterSquash, before })).toBeUndefined();
  });

  it("distinguishes an uncommitted edit from a commit, since HEAD alone cannot", () => {
    const before = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `t-${HEAD}` });
    const after = treeFingerprint({ dirtyPatch: "12345", headSha: HEAD, treeSha: `t-${HEAD}` });
    expect(treeDrift({ after, before })).toBe(
      "HEAD unchanged but the working tree moved (0 → 5 bytes of uncommitted patch)",
    );
  });
});

describe("shortDigest", () => {
  it("takes the leading twelve characters", () => {
    expect(shortDigest({ value: HEAD })).toBe("06e12d9aa1b2");
  });

  it("returns a short input unchanged rather than padding it", () => {
    expect(shortDigest({ value: "abc" })).toBe("abc");
  });
});
