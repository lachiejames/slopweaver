/**
 * `productionMergeProof` against REAL temporary repositories: the property is what git, as actually invoked, says
 * about a merge commit and a working tree, so a fake git would only prove the fake agrees with itself. Every git
 * call the test makes goes through `gitInTemp`, which strips the environment and refuses to run outside the OS temp
 * directory.
 */
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionMergeProof } from "../../../../../cli/commands/handover/wakeMergeProof.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const dirs: string[] = [];

/**
 * A repository with two commits: `merged` on a side branch, and `HEAD` on the base that does not hold it yet.
 *
 * @returns the checkout, the side commit, and the base commit `HEAD` stands on
 */
function repoWithSideCommit(): { dir: string; base: string; merged: string } {
  const dir = mkdtempSync(join(tmpdir(), "wake-merge-proof-"));
  dirs.push(dir);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: dir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: dir });
  writeFileSync(join(dir, "a.txt"), "a\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-qm", "base"], cwd: dir });
  const base = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
  gitInTemp({ args: ["checkout", "-qb", "side"], cwd: dir });
  writeFileSync(join(dir, "b.txt"), "b\n");
  gitInTemp({ args: ["add", "-A"], cwd: dir });
  gitInTemp({ args: ["commit", "-qm", "side"], cwd: dir });
  const merged = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: dir });
  return { base, dir, merged };
}

describe("productionMergeProof", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reads missing before the merge, held on a clean tree after it, and dirty once a file is left untracked", () => {
    const { dir, merged } = repoWithSideCommit();
    const before = unwrap(productionMergeProof({ dir, oid: merged }));
    gitInTemp({ args: ["merge", "-q", "--ff-only", "side"], cwd: dir });
    const after = unwrap(productionMergeProof({ dir, oid: merged }));
    writeFileSync(join(dir, "local.txt"), "an edit a probe could read\n");
    const dirty = unwrap(productionMergeProof({ dir, oid: merged }));
    expect([before, after, dirty]).toEqual(["missing", "held", "dirty"]);
  });

  it("fails on a commit a clean checkout has never seen, and reads dirty on a modified tracked file", () => {
    const { base, dir } = repoWithSideCommit();
    const unknown = productionMergeProof({ dir, oid: "0123456789abcdef0123456789abcdef01234567" });
    writeFileSync(join(dir, "a.txt"), "changed\n");
    const dirty = unwrap(productionMergeProof({ dir, oid: base }));
    expect([unknown.isErr(), dirty]).toEqual([true, "dirty"]);
  });

  // The ancestry read ran with stdio ignored, so the row said only "Command failed" and never git's reason.
  it("names git's own reason when a clean checkout has never seen the merge commit", () => {
    const { dir } = repoWithSideCommit();
    const unknown = productionMergeProof({ dir, oid: "0123456789abcdef0123456789abcdef01234567" });
    expect(unwrapErr(unknown).message).toContain("Not a valid object name");
  });

  // An index flag hides a tracked edit from `git status`, so the tree is unprovable.
  it("reads hidden, not held, on a tracked file flagged assume-unchanged or skip-worktree", () => {
    const proofs: string[] = [];
    for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
      const { base, dir } = repoWithSideCommit();
      gitInTemp({ args: ["update-index", flag, "a.txt"], cwd: dir });
      writeFileSync(join(dir, "a.txt"), "poisoned\n");
      proofs.push(unwrap(productionMergeProof({ dir, oid: base })));
    }
    expect(proofs).toEqual(["hidden", "hidden"]);
  });

  // A submodule's own tree is one status never vouches for — a moved gitlink the
  // repository's config ignores, or an edit its own index flags — so any submodule leaves the tree unprovable.
  it("reads nested, never held, on a checkout holding a submodule, moved or carrying a flagged edit", () => {
    const proofs: string[] = [];
    for (const disturb of ["moved", "flagged"] as const) {
      const { dir } = repoWithSideCommit();
      const child = join(dir, "child");
      gitInTemp({ args: ["init", "-q", "-b", "main", child], cwd: dir });
      writeFileSync(join(child, "f"), "HEAD\n");
      gitInTemp({ args: ["add", "f"], cwd: child });
      gitInTemp({ args: ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "one"], cwd: child });
      gitInTemp({ args: ["-c", "advice.addEmbeddedRepo=false", "add", "child"], cwd: dir });
      gitInTemp({ args: ["commit", "-qm", "gitlink"], cwd: dir });
      const head = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: dir });
      if (disturb === "moved") {
        gitInTemp({
          args: ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "two"],
          cwd: child,
        });
        gitInTemp({ args: ["config", "diff.ignoreSubmodules", "all"], cwd: dir });
      } else {
        gitInTemp({ args: ["update-index", "--assume-unchanged", "f"], cwd: child });
        writeFileSync(join(child, "f"), "EVIL\n");
      }
      proofs.push(unwrap(productionMergeProof({ dir, oid: head })));
    }
    expect(proofs).toEqual(["nested", "nested"]);
  });

  // A replacement ref can give HEAD a parent it never had, and plain git follows it.
  it("reads missing, not held, when only a replacement ref puts the merge in HEAD's history", () => {
    const { base, dir, merged } = repoWithSideCommit();
    const forged = gitInTemp({
      args: ["commit-tree", `${base}^{tree}`, "-p", merged, "-m", "forged"],
      cwd: dir,
    });
    gitInTemp({ args: ["replace", base, forged], cwd: dir });
    const plainSaysHeld = gitInTemp({ args: ["rev-list", "--parents", "-1", base], cwd: dir }).includes(merged);
    expect([plainSaysHeld, unwrap(productionMergeProof({ dir, oid: merged }))]).toEqual([true, "missing"]);
  });

  // Measured on the real checkout (`git ls-files -v -s -z | wc -c`, 1,942,418 bytes): past node's 1 MiB default, every
  // proof failed with `spawnSync git ENOBUFS` and no merged park whose worktree was gone could be finished. The index
  // entries name files that are not on disk, so the listing is large without the test writing thousands of files, and
  // the tree then reads dirty: a verdict only a listing read in full can reach.
  it("reads a checkout whose index listing is past node's default output buffer", () => {
    const { base, dir } = repoWithSideCommit();
    const blob = gitInTemp({ args: ["rev-parse", "HEAD:a.txt"], cwd: dir });
    const entries = Array.from({ length: 4000 }, (_, i) => `100644 ${blob}\tdeep/${String(i)}-${"x".repeat(240)}\n`);
    gitInTemp({ args: ["update-index", "--index-info"], cwd: dir, input: entries.join("") });
    expect(() => gitInTemp({ args: ["ls-files", "-v", "-s", "-z"], cwd: dir })).toThrow("ENOBUFS");
    expect(unwrap(productionMergeProof({ dir, oid: base }))).toBe("dirty");
  });

  // A repository's own core.fileMode=false must not pass a tracked file's mode change.
  it("reads dirty on an executable-bit change the repository's config tells status to ignore", () => {
    const { base, dir } = repoWithSideCommit();
    gitInTemp({ args: ["config", "core.fileMode", "false"], cwd: dir });
    chmodSync(join(dir, "a.txt"), 0o755);
    const plainStatus = gitInTemp({ args: ["status", "--porcelain"], cwd: dir });
    expect([plainStatus, unwrap(productionMergeProof({ dir, oid: base }))]).toEqual(["", "dirty"]);
  });

  // A repository's own stat-cache setting must not pass a same-size edit with its mtime put back.
  it("reads dirty on a same-size edit with its mtime restored under core.checkStat=minimal", () => {
    const { base, dir } = repoWithSideCommit();
    const file = join(dir, "a.txt");
    const old = new Date("2020-01-01T00:00:00Z");
    utimesSync(file, old, old);
    gitInTemp({ args: ["update-index", "--refresh"], cwd: dir });
    gitInTemp({ args: ["config", "core.checkStat", "minimal"], cwd: dir });
    // The edit's ctime must fall in a later second than the one the index recorded, as any real edit's does.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_100);
    writeFileSync(file, "z\n");
    utimesSync(file, old, old);
    const plainStatus = gitInTemp({ args: ["status", "--porcelain"], cwd: dir });
    expect([plainStatus, unwrap(productionMergeProof({ dir, oid: base }))]).toEqual(["", "dirty"]);
  });
});
