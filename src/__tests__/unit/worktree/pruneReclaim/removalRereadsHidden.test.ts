/*
 * A removal re-reads a tree before it goes, because `git worktree remove` does not: hidden edits, untracked files, a
 * switched HEAD, a decoy core.worktree and a checked-out submodule each keep the tree, driven against real git.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyVerdict } from "../../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { hiddenEditsNow } from "../../../../worktree/pruneGit.js";
import { changedSinceScan } from "../../../../worktree/pruneRecheck.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../tempGitRepo.js";
import { COMMIT, dir, seedRepo, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

describe("a removal re-reads hidden files, because git worktree remove does not", REAL_GIT_SUITE, () => {
  /** A linked worktree on `landed` whose one file carries a skip-worktree bit, with a merged verdict. */
  const seedLinked = (): { repo: string; verdict: PruneVerdict } => {
    const repo = seedRepo();
    const path = join(dir, "linked");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
    gitInTemp({ args: ["update-index", "--skip-worktree", "tsconfig.shared.json"], cwd: path });
    const verdict: PruneVerdict = {
      ...verdictFor({ path }),
      branch: "landed",
      cls: "merged",
      deleteBranch: true,
      dropsDeps: false,
    };
    return { repo, verdict };
  };

  it("keeps a tree whose hidden file was edited after the scan, where git alone would have removed it", () => {
    const { repo, verdict } = seedLinked();
    writeFileSync(join(verdict.path, "tsconfig.shared.json"), '{ "extends": "./only-copy.json" }\n');

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("");
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe(
      "a tracked file carries an edit status cannot see, or could not be read, since the scan — kept",
    );
    expect(existsSync(join(verdict.path, "tsconfig.shared.json"))).toBe(true);
  });

  it("removes the same tree when the hidden file still matches its staged blob", () => {
    const { repo, verdict } = seedLinked();

    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(true);
    expect(existsSync(verdict.path)).toBe(false);
  });

  it("never runs a clean filter while reading, so repository code cannot rewrite the file mid-read", () => {
    const { verdict } = seedLinked();
    const marker = join(dir, "filter-ran");
    writeFileSync(join(verdict.path, ".gitattributes"), "tsconfig.shared.json filter=touch\n");
    gitInTemp({ args: ["config", "filter.touch.clean", `touch ${marker}; cat`], cwd: verdict.path });

    expect(hiddenEditsNow({ path: verdict.path })).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it("keeps an interrupted tree whose surviving hidden file was edited after the scan", () => {
    const { repo, verdict } = seedLinked();
    rmSync(join(verdict.path, ".gitignore"));
    writeFileSync(join(verdict.path, "tsconfig.shared.json"), '{ "extends": "./only-copy.json" }\n');

    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.treeRemoved).toBe(false);
    expect(existsSync(join(verdict.path, "tsconfig.shared.json"))).toBe(true);
  });

  it("removes an interrupted tree whose hidden file the failed removal already deleted", () => {
    const { repo, verdict } = seedLinked();
    rmSync(join(verdict.path, ".gitignore"));
    rmSync(join(verdict.path, "tsconfig.shared.json"));

    expect(hiddenEditsNow({ path: verdict.path })).toBe(1);
    expect(hiddenEditsNow({ gutted: true, path: verdict.path })).toBe(0);
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.treeRemoved).toBe(true);
    expect(existsSync(verdict.path)).toBe(false);
  });

  it("keeps an interrupted tree whose deleted file has an edit staged, the staged blob being the only copy", () => {
    const { repo, verdict } = seedLinked();
    writeFileSync(join(verdict.path, ".gitignore"), "only-in-index\n");
    gitInTemp({ args: ["add", ".gitignore"], cwd: verdict.path });
    rmSync(join(verdict.path, ".gitignore"));

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("MD .gitignore");
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.treeRemoved).toBe(false);
    expect(gitInTemp({ args: ["show", ":.gitignore"], cwd: verdict.path })).toBe("only-in-index");
  });

  it("keeps an interrupted tree someone wrote an untracked file into after the scan, never forcing over it", () => {
    const { repo, verdict } = seedLinked();
    rmSync(join(verdict.path, ".gitignore"));
    writeFileSync(join(verdict.path, "scratch.txt"), "the only copy\n");

    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe("no longer only deletions, or its status could not be read, since the scan — kept");
    expect(existsSync(join(verdict.path, "scratch.txt"))).toBe(true);
  });

  it("keeps an interrupted tree switched off its branch onto a commit no ref names (the r3 Codex review)", () => {
    const { repo, verdict } = seedLinked();
    gitInTemp({ args: ["switch", "-q", "--detach"], cwd: verdict.path });
    writeFileSync(join(verdict.path, "unique.txt"), "the only copy\n");
    gitInTemp({ args: ["add", "unique.txt"], cwd: verdict.path });
    gitInTemp({ args: [...COMMIT, "on no ref"], cwd: verdict.path });
    rmSync(join(verdict.path, ".gitignore"));

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("D .gitignore");
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe(
      "its HEAD is no longer on the branch that keeps its commits, or could not be read — kept",
    );
    expect(readFileSync(join(verdict.path, "unique.txt"), "utf8")).toBe("the only copy\n");
  });

  it("keeps a salvaged tree switched off its salvage branch onto a commit no ref names (the r3 Codex review)", () => {
    const { verdict } = seedLinked();
    gitInTemp({ args: ["switch", "-q", "-c", "salvage/x"], cwd: verdict.path });
    gitInTemp({ args: ["switch", "-q", "--detach"], cwd: verdict.path });
    writeFileSync(join(verdict.path, "unique.txt"), "the only copy\n");
    gitInTemp({ args: ["add", "unique.txt"], cwd: verdict.path });
    gitInTemp({ args: [...COMMIT, "on no ref"], cwd: verdict.path });

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("");
    expect(changedSinceScan({ salvagedTo: "salvage/x", verdict: { ...verdict, cls: "salvaged" } })).toBe(
      "its HEAD is no longer on the branch that keeps its commits, or could not be read — kept",
    );
  });

  it("lets a salvaged tree go while its salvage branch, carrying every commit, is still checked out", () => {
    const { verdict } = seedLinked();
    gitInTemp({ args: ["switch", "-q", "-c", "salvage/x"], cwd: verdict.path });
    writeFileSync(join(verdict.path, "unique.txt"), "on the salvage branch\n");
    gitInTemp({ args: ["add", "unique.txt"], cwd: verdict.path });
    gitInTemp({ args: [...COMMIT, "salvaged"], cwd: verdict.path });

    expect(changedSinceScan({ salvagedTo: "salvage/x", verdict: { ...verdict, cls: "salvaged" } })).toBe(null);
  });

  it("keeps an untracked file a repository's status.showUntrackedFiles=no would have hidden from the re-read", () => {
    const { repo, verdict } = seedLinked();
    gitInTemp({ args: ["config", "status.showUntrackedFiles", "no"], cwd: repo });
    rmSync(join(verdict.path, ".gitignore"));
    writeFileSync(join(verdict.path, "scratch.txt"), "the only copy\n");

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("D .gitignore");
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.declined).toBe("no longer only deletions, or its status could not be read, since the scan — kept");
    expect(existsSync(join(verdict.path, "scratch.txt"))).toBe(true);
  });

  it("keeps a tree whose core.worktree points git at a decoy, where --force would delete the real one", () => {
    const { repo, verdict } = seedLinked();
    const decoy = join(dir, "decoy");
    mkdirSync(decoy);
    gitInTemp({ args: ["config", "extensions.worktreeConfig", "true"], cwd: repo });
    gitInTemp({ args: ["config", "--worktree", "core.worktree", decoy], cwd: verdict.path });
    writeFileSync(join(verdict.path, "unique.txt"), "the only copy\n");

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("D .gitignore");
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.declined).toBe(
      "git reads another directory as this tree's working tree, or could not say which — kept",
    );
    expect(existsSync(join(verdict.path, "unique.txt"))).toBe(true);
  });

  it("keeps that untracked file in a merged tree too, which git's own un-forced removal would have deleted", () => {
    const { repo, verdict } = seedLinked();
    gitInTemp({ args: ["config", "status.showUntrackedFiles", "no"], cwd: repo });
    writeFileSync(join(verdict.path, "scratch.txt"), "the only copy\n");

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("");
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
    expect(outcome.declined).toBe("it carries a change, or its status could not be read, since the scan — kept");
    expect(existsSync(join(verdict.path, "scratch.txt"))).toBe(true);
  });

  /** A linked worktree whose committed submodule `mod` is checked out, then one of its own files deleted. */
  const seedWithSubmodule = (): { repo: string; verdict: PruneVerdict } => {
    const { repo, verdict } = seedLinked();
    const sub = join(dir, "sub");
    mkdirSync(sub);
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: sub });
    writeFileSync(join(sub, "inner.txt"), "inside the submodule\n");
    gitInTemp({ args: ["add", "-A"], cwd: sub });
    gitInTemp({ args: [...COMMIT, "sub"], cwd: sub });
    gitInTemp({ args: ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "mod"], cwd: verdict.path });
    gitInTemp({ args: [...COMMIT, "add mod"], cwd: verdict.path });
    rmSync(join(verdict.path, ".gitignore"));
    return { repo, verdict };
  };

  it("keeps an interrupted tree with a submodule checked out, whose objects --force would take with it", () => {
    const { repo, verdict } = seedWithSubmodule();

    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.declined).toBe(
      "it carries a submodule, or git could not say, and --force would delete that checkout — kept",
    );
    expect(existsSync(join(verdict.path, "mod", "inner.txt"))).toBe(true);
  });

  it("keeps it when submodule.mod.active=false lists the checkout as uninitialised", () => {
    const { repo, verdict } = seedWithSubmodule();
    gitInTemp({ args: ["config", "submodule.mod.active", "false"], cwd: verdict.path });

    expect(gitInTemp({ args: ["submodule", "status"], cwd: verdict.path }).startsWith("-")).toBe(true);
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.declined).toBe(
      "it carries a submodule, or git could not say, and --force would delete that checkout — kept",
    );
    expect(existsSync(join(verdict.path, "mod", "inner.txt"))).toBe(true);
  });

  it("reads a dirty submodule as dirt even under diff.ignoreSubmodules=all", () => {
    const { repo, verdict } = seedWithSubmodule();
    gitInTemp({ args: ["config", "diff.ignoreSubmodules", "all"], cwd: repo });
    writeFileSync(join(verdict.path, "mod", "inner.txt"), "an edit nothing else holds\n");

    expect(gitInTemp({ args: ["status", "--porcelain"], cwd: verdict.path })).toBe("D .gitignore");
    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.declined).toBe("no longer only deletions, or its status could not be read, since the scan — kept");
    expect(existsSync(join(verdict.path, "mod", "inner.txt"))).toBe(true);
  });

  it("keeps an interrupted tree whose status can no longer be read", () => {
    const { repo, verdict } = seedLinked();
    rmSync(join(verdict.path, ".gitignore"));
    rmSync(join(verdict.path, ".git"));

    const outcome = applyVerdict({
      repoRoot: repo,
      verdict: { ...verdict, cls: "interrupted" },
    });
    expect(outcome.treeRemoved).toBe(false);
    expect(existsSync(verdict.path)).toBe(true);
  });

  it("keeps an interrupted tree whose hidden file is reached through a symlinked directory", () => {
    const repo = seedRepo();
    mkdirSync(join(repo, "dir"));
    writeFileSync(join(repo, "dir", "file.txt"), "kept\n");
    gitInTemp({ args: ["add", "dir/file.txt"], cwd: repo });
    gitInTemp({ args: [...COMMIT, "nested"], cwd: repo });
    const path = join(dir, "linked");
    gitInTemp({ args: ["worktree", "add", "-q", "-b", "landed", path], cwd: repo });
    gitInTemp({ args: ["update-index", "--skip-worktree", "dir/file.txt"], cwd: path });
    renameSync(join(path, "dir"), join(dir, "moved"));
    symlinkSync(join(dir, "moved"), join(path, "dir"));
    rmSync(join(path, ".gitignore"));

    expect(hiddenEditsNow({ path })).toBe(1);
    expect(hiddenEditsNow({ gutted: true, path })).toBe(1);
    const verdict: PruneVerdict = {
      ...verdictFor({ path }),
      branch: "landed",
      cls: "interrupted",
      deleteBranch: true,
      dropsDeps: false,
    };
    const outcome = applyVerdict({ repoRoot: repo, verdict });
    expect(outcome.treeRemoved).toBe(false);
  });

  it("reads null when the worktree root itself was swapped for a symlink to the real tree", () => {
    const { verdict } = seedLinked();
    const real = join(dir, "real-linked");
    renameSync(verdict.path, real);
    symlinkSync(real, verdict.path);

    expect(hiddenEditsNow({ path: real })).toBe(0);
    expect(hiddenEditsNow({ path: verdict.path })).toBe(null);
  });

  it("reads null when git lists a name that did not decode, rather than calling it deleted", () => {
    const git = (): string => "S bad\uFFFD.txt\0";

    expect(hiddenEditsNow({ git, gutted: true, path: dir })).toBe(null);
  });

  it("reads null for a path git cannot open, so the removal keeps it", () => {
    expect(hiddenEditsNow({ path: join(dir, "absent") })).toBe(null);
  });
});
