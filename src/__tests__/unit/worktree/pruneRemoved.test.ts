/**
 * A pruned tree leaves nothing at its path, its `.git` included, and a removal that cannot finish is reported
 * FAILED, never as a success. The judgement against literal states, the residue sweep against
 * a real directory, and both ends of a removal against a real repository.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyVerdict } from "../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { type AfterRemoval, finishResidue, judgeRemoval } from "../../../worktree/pruneRemoved.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const IDENTITY = ["-c", "user.email=a@b.c", "-c", "user.name=t"];
const REFUSAL = "error: failed to delete '/w': Directory not empty";

/**
 * A residue delete that removes the directory at once, recording what it was handed: the governed delete reads the
 * machine's live fseventsd and holds while the fleet's own prunes keep it hot, and `prunePacing.test.ts` proves it.
 *
 * @param handed where each call's input is recorded
 * @returns the delete, answering whether the directory is gone
 */
const deleteNow =
  ({ handed }: { handed: { dir: string; timeoutMs: number }[] }) =>
  (input: { dir: string; timeoutMs: number }): boolean => {
    handed.push(input);
    rmSync(input.dir, { force: true, recursive: true });
    return !existsSync(input.dir);
  };

/** A tree git stopped on before deleting anything: registered, `.git` present, nothing deleted. */
const untouched: AfterRemoval = { exists: true, gitEntry: true, registered: true, status: "" };

describe("judgeRemoval", () => {
  it("calls a path that is gone removed, whatever git said", () => {
    expect(judgeRemoval({ after: { ...untouched, exists: false }, refusal: REFUSAL })).toEqual({ kind: "removed" });
    expect(judgeRemoval({ after: { ...untouched, exists: false }, refusal: null })).toEqual({ kind: "removed" });
  });

  it("calls a refusal over an untouched tree a decline, in git's words", () => {
    expect(judgeRemoval({ after: untouched, refusal: REFUSAL })).toEqual({ kind: "declined", why: REFUSAL });
  });

  it.each<[string, AfterRemoval, string | null, string]>([
    ["a zero exit over a directory still there", untouched, null, "but its directory is still there"],
    [
      "a registration git already dropped",
      { ...untouched, registered: false, status: null },
      REFUSAL,
      "git has already dropped the registration",
    ],
    [
      "a registration that could not be read",
      { ...untouched, registered: null, status: null },
      REFUSAL,
      "could not be read",
    ],
    ["a tree whose .git is gone", { ...untouched, gitEntry: false, status: null }, REFUSAL, "its .git is gone"],
    ["a status that could not be read", { ...untouched, status: null }, REFUSAL, "its status could not be read"],
    [
      "a tree git already deleted tracked files from",
      { ...untouched, status: " D a.ts\n D b.ts" },
      REFUSAL,
      "2 tracked file(s) already deleted, PARTIALLY REMOVED",
    ],
  ])("calls %s FAILED", (_name, after, refusal, why) => {
    const judged = judgeRemoval({ after, refusal });
    expect(judged.kind).toBe("failed");
    expect(judged).toHaveProperty("why", expect.stringContaining(why));
  });
});

describe("finishResidue", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-residue-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("deletes a residue of build output and a dangling .git, leaving nothing at the path", () => {
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "x", "index.js"), "");
    writeFileSync(join(dir, ".git"), "gitdir: /nowhere\n");
    const handed: { dir: string; timeoutMs: number }[] = [];
    expect(finishResidue({ deleteTree: deleteNow({ handed }), path: dir })).toBe(null);
    expect(existsSync(dir)).toBe(false);
    expect(handed).toEqual([{ dir, timeoutMs: 300_000 }]);
  });

  it("leaves a residue holding anything else, and says what", () => {
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "notes.md"), "only copy\n");
    const handed: { dir: string; timeoutMs: number }[] = [];
    expect(finishResidue({ deleteTree: deleteNow({ handed }), path: dir })).toBe(
      "1 file(s) left in it are not build output, such as notes.md — left for a human",
    );
    expect(existsSync(join(dir, "notes.md"))).toBe(true);
    expect(handed).toEqual([]);
  });

  it("says the build output could not be deleted in time when the delete leaves it", () => {
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    expect(finishResidue({ deleteTree: () => false, path: dir })).toBe(
      "its leftover build output could not be deleted within 5 minutes",
    );
    expect(existsSync(join(dir, "node_modules", "x"))).toBe(true);
  });
});

describe("a removal against a real repository", REAL_GIT_SUITE, () => {
  let seed = "";
  let dir = "";
  let repo = "";
  let tree = "";

  // The base repository is built once and copied for each case — a plain repository's `.git` holds no absolute
  // path, so a copy is the same repository — and each case adds its own worktree to its own copy.
  beforeAll(() => {
    seed = mkdtempSync(join(tmpdir(), "prune-removed-seed-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: seed });
    mkdirSync(join(seed, "locked"));
    writeFileSync(join(seed, "locked", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(seed, ".gitignore"), "node_modules\n");
    gitInTemp({ args: ["add", "-A"], cwd: seed });
    gitInTemp({ args: [...IDENTITY, "commit", "-qm", "base"], cwd: seed });
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(seed, { force: true, recursive: true });
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-removed-"));
    repo = join(dir, "repo");
    cpSync(seed, repo, { recursive: true });
    tree = join(dir, "tree");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", tree], cwd: repo });
  }, REAL_GIT_TIMEOUT_MS);

  afterEach(() => {
    if (existsSync(join(tree, "locked"))) {
      chmodSync(join(tree, "locked"), 0o755);
    }
    rmSync(dir, { force: true, recursive: true });
  });

  const merged = (): PruneVerdict => ({
    branch: "landed",
    cls: "merged",
    deleteBranch: true,
    diskKib: null,
    dropsDeps: false,
    path: tree,
    reason: "merged into the trunk, clean, unreferenced and cold",
  });

  it("leaves nothing at the path of a pruned tree, its .git included, and no registration", () => {
    mkdirSync(join(tree, "node_modules", "x"), { recursive: true });
    writeFileSync(join(tree, "node_modules", "x", "index.js"), "");
    const listedAs = realpathSync(tree);
    expect(gitInTemp({ args: ["worktree", "list", "--porcelain"], cwd: repo })).toContain(listedAs);

    const outcome = applyVerdict({ repoRoot: repo, verdict: merged() });
    expect(outcome.treeRemoved).toBe(true);
    expect(outcome.failed).toBe(false);
    expect(existsSync(tree)).toBe(false);
    expect(gitInTemp({ args: ["worktree", "list", "--porcelain"], cwd: repo })).not.toContain(listedAs);
  });

  it("keeps a tree, and its branch, once another run took the caller's lock over", () => {
    const outcome = applyVerdict({ lockHeld: () => false, repoRoot: repo, verdict: merged() });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe("another run took this run's apply lock over — kept for that run");
    expect(existsSync(tree)).toBe(true);
    expect(gitInTemp({ args: ["branch", "--list", "landed"], cwd: repo })).toContain("landed");
  });

  it("keeps a tree `git worktree lock` locked after the scan, its node_modules untouched, and removes it once unlocked", () => {
    mkdirSync(join(tree, "node_modules", "x"), { recursive: true });
    writeFileSync(join(tree, "node_modules", "x", "index.js"), "");
    const trash = join(dir, "trash");
    gitInTemp({ args: ["worktree", "lock", "--reason", "a seat works here", tree], cwd: repo });

    const outcome = applyVerdict({ bulkTrash: trash, repoRoot: repo, verdict: merged() });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe("locked by `git worktree lock` since the scan — kept");
    expect(existsSync(join(tree, "node_modules", "x", "index.js"))).toBe(true);
    expect(existsSync(trash)).toBe(false);

    gitInTemp({ args: ["worktree", "unlock", tree], cwd: repo });
    expect(applyVerdict({ bulkTrash: trash, repoRoot: repo, verdict: merged() }).treeRemoved).toBe(true);
  });

  it("removes the tree while the caller still holds its lock", () => {
    expect(applyVerdict({ lockHeld: () => true, repoRoot: repo, verdict: merged() }).treeRemoved).toBe(true);
  });

  it("keeps a tree that gained `.slopweaver` state after the scan, which git's own removal would delete", () => {
    mkdirSync(join(tree, ".slopweaver"));
    writeFileSync(join(tree, ".slopweaver", "run.json"), "{}");
    writeFileSync(join(tree, ".gitignore"), "node_modules\n.slopweaver\n");
    gitInTemp({ args: ["add", "-A"], cwd: tree });
    gitInTemp({ args: [...IDENTITY, "commit", "-qm", "ignore state"], cwd: tree });

    const outcome = applyVerdict({ repoRoot: repo, verdict: merged() });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.failed).toBe(false);
    expect(outcome.declined).toBe(
      "it carries ignored files no build writes again, or they could not be listed, since the scan — kept",
    );
    expect(existsSync(join(tree, ".slopweaver", "run.json"))).toBe(true);
  });

  it("keeps a tree a stash was made from after the scan", () => {
    writeFileSync(join(tree, "locked", "a.ts"), "export const a = 2;\n");
    gitInTemp({ args: [...IDENTITY, "stash", "push", "-q", "-m", "half done"], cwd: tree });

    const outcome = applyVerdict({ repoRoot: repo, verdict: merged() });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe(
      "a stash was made from it, or its stashes could not be listed, since the scan — kept",
    );
    expect(existsSync(tree)).toBe(true);
  });

  it("keeps a pushed tree whose branch gained a commit on no remote after the scan", () => {
    const remote = join(dir, "remote.git");
    gitInTemp({ args: ["init", "-q", "--bare", remote], cwd: dir });
    gitInTemp({ args: ["remote", "add", "origin", remote], cwd: repo });
    gitInTemp({ args: ["push", "-q", "origin", "landed"], cwd: tree });
    const pushed: PruneVerdict = { ...merged(), cls: "pushed", deleteBranch: false, reason: "clean and fully pushed" };
    writeFileSync(join(tree, "locked", "a.ts"), "export const a = 3;\n");
    gitInTemp({ args: [...IDENTITY, "commit", "-qam", "after the scan"], cwd: tree });

    const outcome = applyVerdict({ repoRoot: repo, verdict: pushed });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe(
      "it carries a commit origin does not, or its commits could not be counted, since the scan — kept",
    );
    expect(existsSync(tree)).toBe(true);

    gitInTemp({ args: ["push", "-q", "origin", "landed"], cwd: tree });
    expect(applyVerdict({ repoRoot: repo, verdict: pushed }).treeRemoved).toBe(true);
  });

  it("reports a removal git could not finish as FAILED with what was left, never as removed", () => {
    chmodSync(join(tree, "locked"), 0o555);

    const outcome = applyVerdict({ repoRoot: repo, verdict: merged() });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.failed).toBe(true);
    expect(outcome.declined).toContain("left for a human");
    expect(existsSync(join(tree, "locked", "a.ts"))).toBe(true);
  });
});
