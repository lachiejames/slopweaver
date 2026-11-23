import { describe, expect, it } from "vitest";

import {
  reviewPassProvenance,
  stableTree,
  treeAgreeingWithDiffHead,
  withSnapshotCommit,
} from "../../../codex/passProvenance.js";
import type { CodexPassTree } from "../../../codex/types.js";

const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const NEWER_HEAD = "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const DIGEST = "a".repeat(64);
const NEWER_DIGEST = "b".repeat(64);
const SNAPSHOT_COMMIT = "c".repeat(40);

/** Git's content address of what the tree holds — the third reading, on both sides of the comparison. */
const CONTENT_TREE = "d".repeat(40);
const OTHER_CONTENT_TREE = "e".repeat(40);

/** The tree the diff was captured over — what every property in a fan-out must record. */
const DIFF_TREE: CodexPassTree = {
  branch: "feature",
  dirtyBytes: 175,
  fingerprint: DIGEST,
  headSha: HEAD,
  treeSha: "t".repeat(40),
};

/** The same checkout one commit later — what a queued property used to read instead. */
const MOVED_TREE: CodexPassTree = {
  branch: "feature",
  dirtyBytes: 0,
  fingerprint: NEWER_DIGEST,
  headSha: NEWER_HEAD,
  treeSha: "u".repeat(40),
};

describe("withSnapshotCommit", () => {
  it("attaches the frozen copy's commit to the tree", () => {
    expect(withSnapshotCommit({ captured: DIFF_TREE, snapshotCommit: SNAPSHOT_COMMIT })).toEqual({
      ...DIFF_TREE,
      snapshotCommit: SNAPSHOT_COMMIT,
    });
  });

  it("leaves the tree bare when no copy was frozen, rather than claiming one", () => {
    expect(withSnapshotCommit({ captured: DIFF_TREE, snapshotCommit: undefined })).toEqual(DIFF_TREE);
  });

  it("claims nothing when there is no tree to attach a commit to", () => {
    expect(withSnapshotCommit({ captured: undefined, snapshotCommit: SNAPSHOT_COMMIT })).toBe(undefined);
  });
});

describe("stableTree", () => {
  /**
   * DIFF_TREE carries 175 dirty bytes, and that is load-bearing rather than incidental fixture noise: the
   * defect this clause replaced compared a FINGERPRINT of the frozen copy against the live one, and those
   * digest different decompositions of the tree, so it rejected every dirty checkout. A content address holds
   * on both.
   */
  it("records the bracketed DIRTY tree when both endpoints and the frozen copy agree", () => {
    const tree = stableTree({
      after: DIFF_TREE,
      before: DIFF_TREE,
      liveContentTree: CONTENT_TREE,
      snapshotContentTree: CONTENT_TREE,
    });
    expect(tree).toEqual(DIFF_TREE);
    expect(tree!.dirtyBytes).toBe(175);
  });

  it("records the live tree when the two endpoints agree and nothing was frozen", () => {
    const tree = stableTree({
      after: DIFF_TREE,
      before: DIFF_TREE,
      liveContentTree: undefined,
      snapshotContentTree: undefined,
    });
    expect(tree).toEqual(DIFF_TREE);
  });

  it("claims nothing when the checkout moved between the two endpoint readings", () => {
    const tree = stableTree({
      after: MOVED_TREE,
      before: DIFF_TREE,
      liveContentTree: CONTENT_TREE,
      snapshotContentTree: CONTENT_TREE,
    });
    expect(tree).toBe(undefined);
  });

  // Isolates the HEAD clause: only `headSha` differs, so every other reading in this case agrees.
  it("claims nothing when only the head moved, even with both content addresses agreeing", () => {
    const tree = stableTree({
      after: { ...DIFF_TREE, headSha: NEWER_HEAD },
      before: DIFF_TREE,
      liveContentTree: CONTENT_TREE,
      snapshotContentTree: CONTENT_TREE,
    });
    expect(tree).toBe(undefined);
  });

  // The A→B→A dance: both endpoints read A while the frozen copy holds B, so only the third reading sees it.
  it("claims nothing when both endpoints agree but the frozen copy holds other content", () => {
    const tree = stableTree({
      after: DIFF_TREE,
      before: DIFF_TREE,
      liveContentTree: CONTENT_TREE,
      snapshotContentTree: OTHER_CONTENT_TREE,
    });
    expect(tree).toBe(undefined);
  });

  // Fails CLOSED: the hook that moves a snapshot is the hook that breaks the live reading, so excusing the
  // unreadable half hid the divergence that caused it. Only the LIVE half can be absent now — the copy's is a
  // byproduct of a `write-tree` that already succeeded.
  it("claims nothing when a frozen copy exists and the live tree could not be addressed", () => {
    const tree = stableTree({
      after: DIFF_TREE,
      before: DIFF_TREE,
      liveContentTree: undefined,
      snapshotContentTree: CONTENT_TREE,
    });
    expect(tree).toBe(undefined);
  });

  it("claims nothing when either endpoint could not be captured", () => {
    expect(
      stableTree({
        after: DIFF_TREE,
        before: undefined,
        liveContentTree: CONTENT_TREE,
        snapshotContentTree: CONTENT_TREE,
      }),
    ).toBe(undefined);
    expect(
      stableTree({
        after: undefined,
        before: DIFF_TREE,
        liveContentTree: CONTENT_TREE,
        snapshotContentTree: CONTENT_TREE,
      }),
    ).toBe(undefined);
  });
});

describe("reviewPassProvenance", () => {
  it("records the DIFF's tree, carrying this property's own snapshot commit", () => {
    const tree = reviewPassProvenance({ diffTree: DIFF_TREE, snapshotCommit: SNAPSHOT_COMMIT });
    expect(tree).toEqual({ ...DIFF_TREE, snapshotCommit: SNAPSHOT_COMMIT });
  });

  it("records the bare diff tree when no copy could be frozen", () => {
    expect(reviewPassProvenance({ diffTree: DIFF_TREE, snapshotCommit: undefined })).toEqual(DIFF_TREE);
  });

  it("claims nothing when the diff's own tree could not be established", () => {
    expect(reviewPassProvenance({ diffTree: undefined, snapshotCommit: SNAPSHOT_COMMIT })).toBe(undefined);
  });

  /**
   * THE FINDING, as a test. The recorder is handed the tree the diff came from and the frozen copy of a
   * LATER tree that a queued property actually opened, and it records the DIFF's fingerprint — the old
   * recorder read the live tree here and recorded `MOVED_TREE`, whose fingerprint is the CURRENT one, which
   * is exactly what `reviewFailures` accepts as a current review.
   *
   * Falsifiable on the exact digest rather than on inequality: asserting only "not the moved one" would pass
   * for a recorder that claimed nothing at all.
   */
  it("records the diff's tree, never the newer one, however late the property's slot opened", () => {
    const tree = reviewPassProvenance({ diffTree: DIFF_TREE, snapshotCommit: SNAPSHOT_COMMIT });
    expect(tree?.fingerprint).toBe(DIGEST);
    expect(tree?.headSha).toBe(HEAD);
    expect(tree?.fingerprint === MOVED_TREE.fingerprint).toBe(false);
    expect(tree?.headSha === MOVED_TREE.headSha).toBe(false);
  });

  /**
   * Every property in one fan-out records the IDENTICAL tree, which is the property the old recorder broke
   * in both directions at once: an early property read the old tree and reported STALE while its sibling
   * read the new one and reported CURRENT, over one frozen diff.
   *
   * Each property's snapshot commit still differs, because each froze its own copy — that is the one field
   * allowed to vary across the fan-out, and it is asserted rather than assumed.
   */
  it("gives every property in a fan-out the same tree, with its own snapshot commit", () => {
    const commits = ["c1".repeat(20), "c2".repeat(20), "c3".repeat(20)];
    const trees = commits.map((snapshotCommit) => reviewPassProvenance({ diffTree: DIFF_TREE, snapshotCommit }));
    expect(trees.length).toBe(commits.length);
    expect(new Set(trees.map((tree) => tree?.fingerprint)).size).toBe(1);
    expect(trees.map((tree) => tree?.fingerprint)).toEqual([DIGEST, DIGEST, DIGEST]);
    expect(trees.map((tree) => tree?.snapshotCommit)).toEqual(commits);
  });
});

describe("treeAgreeingWithDiffHead", () => {
  it("keeps the bracketed tree when the diff resolved the same HEAD", () => {
    expect(treeAgreeingWithDiffHead({ diffHeadSha: HEAD, tree: DIFF_TREE })).toEqual(DIFF_TREE);
  });

  /**
   * The A→B→A dance, which the endpoints cannot see. The bracket read A twice; the diff's own `rev-parse`
   * landed on B. Two agreeing endpoints prove nothing about the middle, so the honest record is none.
   */
  it("claims nothing when the diff resolved a HEAD the bracket never read", () => {
    expect(treeAgreeingWithDiffHead({ diffHeadSha: NEWER_HEAD, tree: DIFF_TREE })).toBe(undefined);
  });

  it("claims nothing when the endpoints had already disagreed", () => {
    expect(treeAgreeingWithDiffHead({ diffHeadSha: HEAD, tree: undefined })).toBe(undefined);
  });
});
