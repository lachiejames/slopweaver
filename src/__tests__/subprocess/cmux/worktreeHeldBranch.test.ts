/**
 * {@link listWorktrees}'s held branches against REAL git: a branch a rebase or bisect still holds in a tree porcelain
 * prints `detached`, which {@link findWorktreeForBranch} reuses and {@link createWorktree} cannot add elsewhere.
 *
 * Measured: a finished run's tree stopped on a rebase
 * conflict, porcelain printed it `detached`, and a landing row's spawn on its branch died in `git worktree add`.
 */
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { commonGitDir, createWorktree, listWorktrees } from "../../../cmux/worktree.js";
import { findWorktreeForBranch } from "../../../cmux/worktreeList.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** A repository on `main` with three commits each writing `f`, and a linked worktree on `held` at the first. */
function heldFixture({ objectFormat = "sha1" }: { objectFormat?: "sha1" | "sha256" } = {}): {
  repo: string;
  tree: string;
  firstCommit: string;
} {
  const repo = mkdtempSync(join(tmpdir(), "slopweaver-held-"));
  gitInTemp({ args: ["init", "-q", "-b", "main", `--object-format=${objectFormat}`], cwd: repo });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: repo });
  writeFileSync(join(repo, "f"), "base\n");
  gitInTemp({ args: ["add", "f"], cwd: repo });
  gitInTemp({ args: ["commit", "-q", "-m", "base"], cwd: repo });
  const firstCommit = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
  const tree = join(mkdtempSync(join(tmpdir(), "slopweaver-held-wt-")), "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "held", tree], cwd: repo });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: tree });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: tree });
  writeFileSync(join(tree, "f"), "held\n");
  gitInTemp({ args: ["commit", "-q", "-am", "held"], cwd: tree });
  writeFileSync(join(repo, "f"), "trunk\n");
  gitInTemp({ args: ["commit", "-q", "-am", "trunk"], cwd: repo });
  return { firstCommit, repo, tree };
}

describe("a branch a rebase or bisect holds in a detached worktree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reports a rebase's held branch, reuses that tree for it, and git refuses the branch anywhere else", () => {
    const { repo, tree } = heldFixture();
    expect(() => gitInTemp({ args: ["rebase", "main"], cwd: tree })).toThrow();

    const listed = listWorktrees({ repoRoot: repo });
    const heldTree = listed.find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(heldTree.branch).toBe(null);
    expect(heldTree.heldBranches).toEqual(["held"]);
    expect(findWorktreeForBranch({ candidates: ["held"], worktrees: listed })).toEqual(heldTree);

    const elsewhere = join(mkdtempSync(join(tmpdir(), "slopweaver-held-elsewhere-")), "wt");
    expect(() => createWorktree({ baseBranch: undefined, branch: "held", path: elsewhere, repoRoot: repo })).toThrow(
      "already used by worktree",
    );
  });

  it("reports a bisect's held branch once the bisect has detached the tree", () => {
    const { firstCommit, repo, tree } = heldFixture();
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-2"], cwd: tree });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-3"], cwd: tree });
    gitInTemp({ args: ["bisect", "start", "held", firstCommit], cwd: tree });

    const heldTree = listWorktrees({ repoRoot: repo }).find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(heldTree.branch).toBe(null);
    expect(heldTree.heldBranches).toEqual(["held"]);
  });

  // Reproduced on git 2.54.0: a bisect started on a detached HEAD records the full id, and git holds the
  // branch named by its abbreviation — never one named by the forty characters.
  it("reports the abbreviation a bisect started on a detached HEAD holds, and git refuses it elsewhere", () => {
    const { firstCommit, repo, tree } = heldFixture();
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-2"], cwd: tree });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-3"], cwd: tree });
    gitInTemp({ args: ["checkout", "-q", "--detach"], cwd: tree });
    const short = gitInTemp({ args: ["rev-parse", "--short", "HEAD"], cwd: tree });
    gitInTemp({ args: ["branch", short, firstCommit], cwd: repo });
    gitInTemp({ args: ["bisect", "start", "HEAD", firstCommit], cwd: tree });

    const heldTree = listWorktrees({ repoRoot: repo }).find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(heldTree.heldBranches).toEqual([short]);
    const elsewhere = join(mkdtempSync(join(tmpdir(), "slopweaver-held-abbrev-")), "wt");
    expect(() => createWorktree({ baseBranch: undefined, branch: short, path: elsewhere, repoRoot: repo })).toThrow(
      "already used by worktree",
    );
  });

  // A claim that `rev-parse --short` resolves a ref sharing the id's full name is wrong; git 2.54.0 abbreviates
  // the raw id and only warns, so the hold is still the id's own abbreviation.
  it("reports the id's own abbreviation when a branch shares the bisect's full starting id as its name", () => {
    const { firstCommit, repo, tree } = heldFixture();
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-2"], cwd: tree });
    gitInTemp({ args: ["checkout", "-q", "--detach"], cwd: tree });
    const fullHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    const short = gitInTemp({ args: ["rev-parse", "--short", "HEAD"], cwd: tree });
    gitInTemp({ args: ["branch", fullHead, firstCommit], cwd: repo });
    gitInTemp({ args: ["bisect", "start", "HEAD", firstCommit], cwd: tree });

    const heldTree = listWorktrees({ repoRoot: repo }).find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(heldTree.heldBranches).toEqual([short]);
  });

  // The hold git compares is abbreviated by the configuration of the worktree whose git would
  // refuse the branch, a worktree-specific core.abbrev included — so it is read from the listing's own directory.
  it("abbreviates a bisect's starting id with the listing worktree's own core.abbrev", () => {
    const { firstCommit, repo, tree } = heldFixture();
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-2"], cwd: tree });
    gitInTemp({ args: ["checkout", "-q", "--detach"], cwd: tree });
    gitInTemp({ args: ["config", "extensions.worktreeConfig", "true"], cwd: repo });
    gitInTemp({ args: ["config", "core.abbrev", "7"], cwd: repo });
    const caller = join(mkdtempSync(join(tmpdir(), "slopweaver-held-caller-")), "caller");
    gitInTemp({ args: ["worktree", "add", "-q", "--detach", caller, firstCommit], cwd: repo });
    gitInTemp({ args: ["config", "--worktree", "core.abbrev", "12"], cwd: caller });
    const treeShort = gitInTemp({ args: ["rev-parse", "--short", "HEAD"], cwd: tree });
    const fullHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree });
    gitInTemp({ args: ["bisect", "start", "HEAD", firstCommit], cwd: tree });

    const heldTree = listWorktrees({ repoRoot: caller }).find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(treeShort).toBe(fullHead.slice(0, 7));
    expect(heldTree.heldBranches).toEqual([fullHead.slice(0, 12)]);
  });

  // A SHA-256 repository's get_oid_hex wants sixty-four digits, so a forty-hex BISECT_START is
  // the branch's own name there, never an id to abbreviate.
  it("reports a forty-hex branch a bisect holds in a SHA-256 repository by its own name", () => {
    const { firstCommit, repo, tree } = heldFixture({ objectFormat: "sha256" });
    const fortyHex = "a".repeat(40);
    gitInTemp({ args: ["checkout", "-q", "-b", fortyHex], cwd: tree });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-2"], cwd: tree });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "held-3"], cwd: tree });
    gitInTemp({ args: ["bisect", "start", fortyHex, firstCommit], cwd: tree });

    const heldTree = listWorktrees({ repoRoot: repo }).find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(heldTree.branch).toBe(null);
    expect(heldTree.heldBranches).toEqual([fortyHex]);
    const elsewhere = join(mkdtempSync(join(tmpdir(), "slopweaver-held-sha256-")), "wt");
    expect(() => createWorktree({ baseBranch: undefined, branch: fortyHex, path: elsewhere, repoRoot: repo })).toThrow(
      "already used by worktree",
    );
  });

  // Trimming git's output would turn `common ` into a different, sibling directory.
  it("resolves a common git directory whose name ends in a space, keeping the space", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "slopweaver-held-space-")));
    const repo = join(root, "repo");
    const separate = join(root, "common ");
    gitInTemp({ args: ["init", "-q", "-b", "main", `--separate-git-dir=${separate}`, repo], cwd: root });
    expect(commonGitDir({ repoRoot: repo })).toBe(separate);
  });

  // Git lists a --separate-git-dir main checkout at its common directory, where its state lives.
  it("reports a rebase's held branch in a main checkout whose git directory is separate", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "slopweaver-held-separate-")));
    const checkout = join(root, "wt");
    const meta = join(root, "meta");
    gitInTemp({ args: ["init", "-q", "-b", "main", `--separate-git-dir=${meta}`, checkout], cwd: root });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: checkout });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: checkout });
    writeFileSync(join(checkout, "f"), "base\n");
    gitInTemp({ args: ["add", "f"], cwd: checkout });
    gitInTemp({ args: ["commit", "-q", "-m", "base"], cwd: checkout });
    gitInTemp({ args: ["checkout", "-q", "-b", "held"], cwd: checkout });
    writeFileSync(join(checkout, "f"), "held\n");
    gitInTemp({ args: ["commit", "-q", "-am", "held"], cwd: checkout });
    gitInTemp({ args: ["checkout", "-q", "main"], cwd: checkout });
    writeFileSync(join(checkout, "f"), "trunk\n");
    gitInTemp({ args: ["commit", "-q", "-am", "trunk"], cwd: checkout });
    gitInTemp({ args: ["checkout", "-q", "held"], cwd: checkout });
    expect(() => gitInTemp({ args: ["rebase", "main"], cwd: checkout })).toThrow();

    const listed = listWorktrees({ repoRoot: checkout });
    expect(listed).toEqual([{ branch: null, heldBranches: ["held"], path: meta }]);
  });

  // Git realpaths a RELATIVE gitdir record, so a symlink on its way lists the tree at the real
  // path — and git still refuses the branch it holds there.
  it("reports a rebase's held branch when the tree's relative gitdir record runs through a symlink", () => {
    const { repo, tree } = heldFixture();
    expect(() => gitInTemp({ args: ["rebase", "main"], cwd: tree })).toThrow();
    const realParent = realpathSync(dirname(tree));
    const alias = `${realParent}-alias`;
    symlinkSync(realParent, alias);
    const entry = realpathSync(join(repo, ".git", "worktrees", "wt"));
    writeFileSync(join(entry, "gitdir"), `${relative(entry, join(alias, "wt", ".git"))}\n`);

    const heldTree = listWorktrees({ repoRoot: repo }).find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(heldTree).toEqual({ branch: null, heldBranches: ["held"], path: join(realParent, "wt") });
    const elsewhere = join(mkdtempSync(join(tmpdir(), "slopweaver-held-symlink-")), "wt");
    expect(() => createWorktree({ baseBranch: undefined, branch: "held", path: elsewhere, repoRoot: repo })).toThrow(
      "already used by worktree",
    );
  });

  it("reports no held branch for a tree merely detached", () => {
    const { repo, tree } = heldFixture();
    gitInTemp({ args: ["checkout", "-q", "--detach"], cwd: tree });

    const plainTree = listWorktrees({ repoRoot: repo }).find((worktree) => worktree.path.endsWith("/wt"))!;
    expect(plainTree).toEqual({ branch: null, path: plainTree.path });
  });
});
