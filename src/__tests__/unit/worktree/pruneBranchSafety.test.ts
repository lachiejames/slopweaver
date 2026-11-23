/**
 * The two halves of a review's counterexample on a branch, each against a REAL repository: a
 * patch `git cherry` calls absorbed while its bytes are in no trunk commit, and a branch its own repository made
 * its own upstream, which `git branch -d` then deleted as "merged". The pure parsers are pinned beside them.
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyVerdict } from "../../../worktree/pruneApply.js";
import { deleteBranchInTrunk } from "../../../worktree/pruneBranchDelete.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { everyBranchPatchInTrunk, patchIdsIn, pathKeysIn } from "../../../worktree/prunePatchIds.js";
import { branchAbsorbed } from "../../../worktree/pruneScan.js";
import {
  isSnapshotPoolSlot,
  SNAPSHOT_POOL_IDENTITY_FILE,
  snapshotPoolRoot,
} from "../../../worktree/snapshotPoolPath.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../tempGitRepo.js";

const COMMIT = ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qm"];
const TRUNK = "refs/remotes/origin/main";

const A = "a".repeat(40);
const B = "b".repeat(40);
const T = "c".repeat(40);
const P1 = "1".repeat(40);
const P2 = "2".repeat(40);

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prune-branch-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Commit everything in a checkout under a message. */
const commitAll = ({ cwd, message }: { cwd: string; message: string }): void => {
  gitInTemp({ args: ["add", "-A"], cwd });
  gitInTemp({ args: [...COMMIT, message], cwd });
};

/** Point the remote-tracking trunk, and `origin/HEAD`, at what `main` holds now. */
const publishTrunk = ({ repo }: { repo: string }): void => {
  gitInTemp({ args: ["update-ref", TRUNK, "refs/heads/main"], cwd: repo });
  gitInTemp({ args: ["symbolic-ref", "refs/remotes/origin/HEAD", TRUNK], cwd: repo });
};

/** A repository whose `main` holds `f` as `x\n`, with a `feature` branch cut from it. */
const seedRepo = (): string => {
  const repo = join(dir, "repo");
  mkdirSync(repo);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: repo });
  writeFileSync(join(repo, "f"), "x\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules\n");
  commitAll({ cwd: repo, message: "base" });
  gitInTemp({ args: ["branch", "feature"], cwd: repo });
  return repo;
};

/**
 * Commit `f` with one content on `feature` and another on `main`, then publish `main` as the trunk.
 *
 * @returns the repository
 */
const diverge = ({ onBranch, onTrunk }: { onBranch: string; onTrunk: string }): string => {
  const repo = seedRepo();
  gitInTemp({ args: ["switch", "-q", "feature"], cwd: repo });
  writeFileSync(join(repo, "f"), onBranch);
  commitAll({ cwd: repo, message: "feature" });
  gitInTemp({ args: ["switch", "-q", "main"], cwd: repo });
  writeFileSync(join(repo, "f"), onTrunk);
  commitAll({ cwd: repo, message: "trunk" });
  publishTrunk({ repo });
  return repo;
};

const absorbed = ({ repo }: { repo: string }): boolean | null =>
  branchAbsorbed({ branch: "refs/heads/feature", repoRoot: repo, trunk: TRUNK });

/** What `git cherry` says of the one feature commit: `-` absorbed, `+` not. */
const cherrySign = ({ repo }: { repo: string }): string =>
  gitInTemp({ args: ["cherry", TRUNK, "feature"], cwd: repo }).slice(0, 1);

describe("absorption is by verbatim patch id", REAL_GIT_SUITE, () => {
  it("keeps a branch whose only difference from the trunk is whitespace, which git cherry calls absorbed", () => {
    const repo = diverge({ onBranch: " x\n", onTrunk: "\tx\n" });
    expect(cherrySign({ repo })).toBe("-");
    expect(absorbed({ repo })).toBe(false);
  });

  it("keeps a branch whose only difference from the trunk is its line endings", () => {
    const repo = diverge({ onBranch: "y\n", onTrunk: "y\r\n" });
    expect(cherrySign({ repo })).toBe("-");
    expect(absorbed({ repo })).toBe(false);
  });

  it("keeps a branch whose edit a configured textconv renders the same as the trunk's", () => {
    const repo = diverge({ onBranch: "Y\n", onTrunk: "y\n" });
    gitInTemp({ args: ["config", "diff.up.textconv", "tr a-z A-Z"], cwd: repo });
    writeFileSync(join(repo, ".git", "info", "attributes"), "f diff=up\n");
    expect(absorbed({ repo })).toBe(false);
  });

  it("keeps a branch whose edit differs from the trunk's in its executable bit alone", () => {
    const repo = seedRepo();
    gitInTemp({ args: ["switch", "-q", "feature"], cwd: repo });
    writeFileSync(join(repo, "f"), "y\n");
    chmodSync(join(repo, "f"), 0o755);
    commitAll({ cwd: repo, message: "feature" });
    gitInTemp({ args: ["switch", "-q", "main"], cwd: repo });
    writeFileSync(join(repo, "f"), "y\n");
    chmodSync(join(repo, "f"), 0o644);
    commitAll({ cwd: repo, message: "trunk" });
    publishTrunk({ repo });
    expect(absorbed({ repo })).toBe(false);
  });

  it("clears a branch whose exact change landed on the trunk under a new SHA", () => {
    const repo = diverge({ onBranch: "y\n", onTrunk: "y\n" });
    expect(absorbed({ repo })).toBe(true);
  });
});

/**
 * A repository with `feature` checked out in a linked worktree and a `merged` verdict over it.
 *
 * @param commitOnBranch whether the worktree commits a file the trunk never receives
 * @returns the repository, the verdict and the branch tip
 */
const linkedFeature = ({
  commitOnBranch,
}: {
  commitOnBranch: boolean;
}): {
  repo: string;
  verdict: PruneVerdict;
  tip: string;
} => {
  const repo = seedRepo();
  publishTrunk({ repo });
  const path = join(dir, "linked");
  gitInTemp({ args: ["worktree", "add", "-q", path, "feature"], cwd: repo });
  if (commitOnBranch) {
    writeFileSync(join(path, "only-copy"), " the only copy\n");
    commitAll({ cwd: path, message: "only copy" });
  }
  return { repo, tip: gitInTemp({ args: ["rev-parse", "feature"], cwd: repo }), verdict: mergedVerdict({ path }) };
};

/** A `merged` verdict over the `feature` tree at a path. */
const mergedVerdict = ({ path }: { path: string }): PruneVerdict => ({
  branch: "feature",
  cls: "merged",
  deleteBranch: true,
  diskKib: null,
  dropsDeps: false,
  path,
  reason: "merged into the trunk, clean, unreferenced and cold",
});

/**
 * Rewrite one commit's first parent inside the repository's commit-graph file, and re-seal its checksum.
 *
 * Layout per the commit-graph format: a chunk table from byte 8 of 12-byte `id, offset` rows, OIDL holding sorted
 * 20-byte ids, CDAT holding a 36-byte row per commit whose first parent index sits after the 20-byte tree id.
 */
const forgeGraphParent = ({ child, parent, repo }: { child: string; parent: string; repo: string }): void => {
  const file = join(repo, ".git", "objects", "info", "commit-graph");
  const buf = Buffer.from(readFileSync(file));
  const chunks = new Map<string, number>();
  for (let i = 0; i <= buf[6]!; i++) {
    chunks.set(buf.subarray(8 + i * 12, 12 + i * 12).toString("latin1"), Number(buf.readBigUInt64BE(12 + i * 12)));
  }
  const oidl = chunks.get("OIDL")!;
  const cdat = chunks.get("CDAT")!;
  const ids = Array.from({ length: (cdat - oidl) / 20 }, (_, i) =>
    buf.subarray(oidl + i * 20, oidl + (i + 1) * 20).toString("hex"),
  );
  buf.writeUInt32BE(ids.indexOf(parent), cdat + ids.indexOf(child) * 36 + 20);
  createHash("sha1")
    .update(buf.subarray(0, buf.length - 20))
    .digest()
    .copy(buf, buf.length - 20);
  chmodSync(file, 0o644);
  writeFileSync(file, buf);
};

const HELD_ELSEWHERE =
  "another worktree has it checked out or a rebase or bisect there holds it, or the worktree list could not be read";

const SYMBOLIC = "the trunk resolves to the branch itself, or either is a symbolic ref, or git could not say";

const tipOf = ({ repo }: { repo: string }): string =>
  gitInTemp({ args: ["for-each-ref", "--format=%(objectname)", "refs/heads/feature"], cwd: repo });

describe("a merged tree's branch is deleted only at a tip the trunk carries", REAL_GIT_SUITE, () => {
  it("keeps a branch its repository made its own upstream, where git branch -d deleted it", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: true });
    gitInTemp({ args: ["config", "branch.feature.remote", "."], cwd: repo });
    gitInTemp({ args: ["config", "branch.feature.merge", "refs/heads/feature"], cwd: repo });

    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe(
      "its tip is not in refs/remotes/origin/main, which a squash merge leaves it, or git could not say",
    );
    expect(tipOf({ repo })).toBe(tip);
  });

  it("deletes a branch whose tip the trunk already contains", () => {
    const { repo, verdict } = linkedFeature({ commitOnBranch: false });
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.branchDeleted).toBe(true);
    expect(outcome.declined).toBe(null);
    expect(tipOf({ repo })).toBe("");
  });

  it("deletes it with the repository's reference-transaction hook refusing every ref change", () => {
    const { repo, verdict } = linkedFeature({ commitOnBranch: false });
    const hook = join(repo, ".git", "hooks", "reference-transaction");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.branchDeleted).toBe(true);
    expect(tipOf({ repo })).toBe("");
  });

  it("keeps a branch another worktree still has checked out, the one protection git branch -d gave", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: false });
    gitInTemp({ args: ["worktree", "add", "-q", "-f", join(dir, "second"), "feature"], cwd: repo });
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe(HELD_ELSEWHERE);
    expect(tipOf({ repo })).toBe(tip);
  });

  // `update-ref` skips git's own refusal to delete a branch a rebase holds, and a held tree lists as detached.
  it("keeps a branch a rebase in another, detached worktree still holds", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: false });
    const second = join(dir, "second");
    gitInTemp({ args: ["worktree", "add", "-q", "-f", "--detach", second, "feature"], cwd: repo });
    const secondGitDir = gitInTemp({ args: ["rev-parse", "--absolute-git-dir"], cwd: second });
    mkdirSync(join(secondGitDir, "rebase-merge"));
    writeFileSync(join(secondGitDir, "rebase-merge", "head-name"), "refs/heads/feature\n");
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe(HELD_ELSEWHERE);
    expect(tipOf({ repo })).toBe(tip);
  });

  // Prune's own listing hides a detached snapshot-pool slot, and a bisect there still holds.
  it("keeps a branch a bisect in a detached snapshot-pool slot still holds", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: false });
    const poolRoot = snapshotPoolRoot({ commonGitDir: "/pool/.git", poolParent: dir });
    const slotTree = join(poolRoot, "slot-0", "tree");
    mkdirSync(join(poolRoot, "slot-0"), { recursive: true });
    writeFileSync(join(poolRoot, SNAPSHOT_POOL_IDENTITY_FILE), "/pool/.git");
    writeFileSync(join(poolRoot, "slot-0", "state.free"), "");
    gitInTemp({ args: ["worktree", "add", "-q", "-f", "--detach", slotTree, "feature"], cwd: repo });
    const slotGitDir = gitInTemp({ args: ["rev-parse", "--absolute-git-dir"], cwd: slotTree });
    writeFileSync(join(slotGitDir, "BISECT_START"), "feature\n");
    writeFileSync(join(slotGitDir, "BISECT_LOG"), "git bisect start\n");
    expect(isSnapshotPoolSlot({ path: slotTree })).toBe(true);
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe(HELD_ELSEWHERE);
    expect(tipOf({ repo })).toBe(tip);
  });

  it("keeps a branch whose edit shares a patch id with the trunk's at another line, which absorption cannot see", () => {
    const block = "a\nb\nc\nx\nd\ne\nf\n";
    const repo = seedRepo();
    writeFileSync(join(repo, "f"), `${block}sep\n${block}`);
    commitAll({ cwd: repo, message: "two blocks" });
    gitInTemp({ args: ["branch", "-f", "feature"], cwd: repo });
    writeFileSync(join(repo, "f"), `${block}sep\n${block.replace("x", "y")}`);
    commitAll({ cwd: repo, message: "trunk edits the second block" });
    publishTrunk({ repo });
    const path = join(dir, "linked");
    gitInTemp({ args: ["worktree", "add", "-q", path, "feature"], cwd: repo });
    writeFileSync(join(path, "f"), `${block.replace("x", "y")}sep\n${block}`);
    commitAll({ cwd: path, message: "feature edits the first block" });
    const tip = gitInTemp({ args: ["rev-parse", "feature"], cwd: repo });

    expect(absorbed({ repo })).toBe(true);
    const outcome = applyVerdict({ repoRoot: repo, verdict: mergedVerdict({ path }) });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.branchDeleted).toBe(false);
    expect(tipOf({ repo })).toBe(tip);
  });

  it("keeps a branch a graft file makes look like an ancestor of the trunk", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: true });
    writeFileSync(join(repo, "base-file"), "trunk only\n");
    commitAll({ cwd: repo, message: "trunk moves" });
    publishTrunk({ repo });
    const trunkTip = gitInTemp({ args: ["rev-parse", TRUNK], cwd: repo });
    writeFileSync(join(repo, ".git", "info", "grafts"), `${trunkTip} ${tip}\n`);
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe(
      "its tip is not in refs/remotes/origin/main, which a squash merge leaves it, or git could not say",
    );
    expect(tipOf({ repo })).toBe(tip);
  });

  it("keeps a branch a forged commit-graph parent makes look like an ancestor of the trunk", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: true });
    writeFileSync(join(repo, "base-file"), "trunk only\n");
    commitAll({ cwd: repo, message: "trunk moves" });
    publishTrunk({ repo });
    gitInTemp({ args: ["commit-graph", "write", "--reachable"], cwd: repo });
    forgeGraphParent({ child: gitInTemp({ args: ["rev-parse", TRUNK], cwd: repo }), parent: tip, repo });
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe(
      "its tip is not in refs/remotes/origin/main, which a squash merge leaves it, or git could not say",
    );
    expect(tipOf({ repo })).toBe(tip);
  });

  // A case-sensitive disk keeps each of these on the ancestry check instead; a folding one, macOS's, is the subject.
  it.each([
    { branch: "feature", twin: "refs/heads/FEATURE" },
    { branch: "xς", twin: "refs/heads/xσ" },
    { branch: "ſeature", twin: "refs/heads/seature" },
    { branch: "feature", twin: "refs/HEADS/feature" },
  ])("keeps a packed $branch that a folding disk answers with the loose $twin", ({ branch, twin }) => {
    const repo = seedRepo();
    publishTrunk({ repo });
    gitInTemp({ args: ["switch", "-q", "-C", branch], cwd: repo });
    writeFileSync(join(repo, "only-copy"), "the only copy\n");
    commitAll({ cwd: repo, message: "only copy" });
    gitInTemp({ args: ["switch", "-q", "main"], cwd: repo });
    const tip = gitInTemp({ args: ["rev-parse", branch], cwd: repo });
    gitInTemp({ args: ["pack-refs", "--all"], cwd: repo });
    rmSync(join(repo, ".git", "refs", "heads"), { force: true, recursive: true });
    gitInTemp({ args: ["update-ref", twin, gitInTemp({ args: ["rev-parse", TRUNK], cwd: repo })], cwd: repo });
    const path = join(dir, "linked");
    gitInTemp({ args: ["worktree", "add", "-q", path, branch], cwd: repo });
    const outcome = applyVerdict({ repoRoot: repo, verdict: { ...mergedVerdict({ path }), branch } });
    expect(outcome.branchDeleted).toBe(false);
    expect(
      gitInTemp({ args: ["for-each-ref", "--contains", tip, "--format=%(refname)", "refs/heads/"], cwd: repo }),
    ).toBe(`refs/heads/${branch}`);
  });

  it("keeps a branch the trunk ref names symbolically, which every tip check would pass against itself", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: true });
    gitInTemp({ args: ["symbolic-ref", TRUNK, "refs/heads/feature"], cwd: repo });
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe(SYMBOLIC);
    expect(tipOf({ repo })).toBe(tip);
  });

  it("keeps the tree and the branch when the branch is itself a symbolic ref", () => {
    const { repo, verdict } = linkedFeature({ commitOnBranch: false });
    gitInTemp({ args: ["branch", "carrier", "feature"], cwd: repo });
    gitInTemp({ args: ["symbolic-ref", "refs/heads/feature", "refs/heads/carrier"], cwd: repo });
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.branchDeleted).toBe(false);
    expect(gitInTemp({ args: ["symbolic-ref", "refs/heads/feature"], cwd: repo })).toBe("refs/heads/carrier");
  });

  it("deletes a branch with no tree at all only while the trunk contains its tip", () => {
    const repo = seedRepo();
    publishTrunk({ repo });
    gitInTemp({ args: ["branch", "landed"], cwd: repo });
    expect(deleteBranchInTrunk({ branch: "landed", repoRoot: repo })).toEqual({ declined: null, deleted: true });
    expect(deleteBranchInTrunk({ branch: "feature", repoRoot: repo })).toEqual({ declined: null, deleted: true });

    gitInTemp({ args: ["switch", "-q", "-c", "ahead"], cwd: repo });
    writeFileSync(join(repo, "only-copy"), "the only copy\n");
    commitAll({ cwd: repo, message: "only copy" });
    gitInTemp({ args: ["switch", "-q", "main"], cwd: repo });
    expect(deleteBranchInTrunk({ branch: "ahead", repoRoot: repo })).toEqual({
      declined: "its tip is not in refs/remotes/origin/main, which a squash merge leaves it, or git could not say",
      deleted: false,
    });
  });

  it("keeps the branch when the repository names no trunk", () => {
    const { repo, tip, verdict } = linkedFeature({ commitOnBranch: false });
    gitInTemp({ args: ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], cwd: repo });
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.branchDeleted).toBe(false);
    expect(outcome.declined).toBe("the trunk ref could not be read");
    expect(tipOf({ repo })).toBe(tip);
  });
});

describe("patchIdsIn", () => {
  it("reads each record's patch id by its commit, of either hash length", () => {
    const long = "e".repeat(64);
    const ids = patchIdsIn({ listing: `${P1} ${A}\n${P2} ${long}\n` });
    expect(ids).toEqual(
      new Map([
        [A, P1],
        [long, P2],
      ]),
    );
  });

  it("reads empty output as no ids", () => {
    expect(patchIdsIn({ listing: "" })).toEqual(new Map());
  });

  it("refuses a malformed or truncated record rather than skipping it", () => {
    expect(patchIdsIn({ listing: `${P1} ${A}\n${P2}` })).toBe(null);
    expect(patchIdsIn({ listing: `${P1} ${A.slice(1)}` })).toBe(null);
  });
});

describe("pathKeysIn", () => {
  it("keys each commit by its sorted paths, an empty commit by nothing", () => {
    const keys = pathKeysIn({ listing: `\0${A}\n\nz.ts\na.ts\n\0${B}\n` });
    expect(keys).toEqual(
      new Map([
        [A, "a.ts\0z.ts"],
        [B, ""],
      ]),
    );
  });

  it("refuses a path before any commit, and a malformed sha", () => {
    expect(pathKeysIn({ listing: `a.ts\n\0${A}\n` })).toBe(null);
    expect(pathKeysIn({ listing: "\0not-a-sha\na.ts" })).toBe(null);
  });
});

describe("everyBranchPatchInTrunk", () => {
  const branchKeys = new Map([
    [A, "f"],
    [B, ""],
  ]);

  it("is true when every branch commit with a path has its id among the trunk candidates'", () => {
    const ids = new Map([
      [A, P1],
      [T, P1],
    ]);
    expect(everyBranchPatchInTrunk({ branchKeys, ids, trunkCandidates: [T] })).toBe(true);
  });

  it("is false when a branch commit's id is not among them, or it has no id at all", () => {
    expect(
      everyBranchPatchInTrunk({
        branchKeys,
        ids: new Map([
          [A, P1],
          [T, P2],
        ]),
        trunkCandidates: [T],
      }),
    ).toBe(false);
    expect(everyBranchPatchInTrunk({ branchKeys, ids: new Map([[T, P1]]), trunkCandidates: [T] })).toBe(false);
  });
});
