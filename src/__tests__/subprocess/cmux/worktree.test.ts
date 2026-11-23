/**
 * {@link parseWorktreeListPorcelain}, {@link findWorktreeForBranch}, {@link findWorktreeAtPath} and
 * {@link parseRemoteDefaultBranch} against real `git worktree` / `git ls-remote` shapes, plus end-to-end
 * fixtures proving {@link createWorktree} against a REAL remote and a REAL stray-checkout main worktree — the
 * exact live discovery `worktree-base-resolution-fix.md` exists for — and against the two failure shapes
 * `cmux-spawn-existing-worktree-collision` measured: a directory already at the path, and an `add` that
 * dies part-way and must leave no branch or directory behind.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { describeGitWriteFailure, summariseGitStderr } from "../../../cmux/gitWriteFailure.js";
import { parseRemoteDefaultBranch } from "../../../cmux/trunkRef.js";
import { createWorktree, listWorktrees, resetWorktreeToFreshTrunk } from "../../../cmux/worktree.js";
import { findWorktreeAtPath, findWorktreeForBranch, parseWorktreeListPorcelain } from "../../../cmux/worktreeList.js";
import { productionProvisionDeps } from "../../../worktree/provision.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

/** A real `git worktree list --porcelain` capture: main + one named branch + one detached snapshot. */
const PORCELAIN = [
  "worktree /repo/slopweaver",
  "HEAD 7c6d1521a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "branch refs/heads/main",
  "",
  "worktree /repo/slopweaver-fleet/passage-head-reserve",
  "HEAD 677e06e1a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "branch refs/heads/retrieval-passage-head",
  "",
  "worktree /private/var/folders/tmp/slopweaver-snap-abc/tree",
  "HEAD e292bcd1a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "detached",
  "",
].join("\n");

describe("parseWorktreeListPorcelain", () => {
  it("reads every worktree's path and branch", () => {
    expect(parseWorktreeListPorcelain({ text: PORCELAIN })).toEqual([
      { branch: "main", path: "/repo/slopweaver" },
      {
        branch: "retrieval-passage-head",
        path: "/repo/slopweaver-fleet/passage-head-reserve",
      },
      { branch: null, path: "/private/var/folders/tmp/slopweaver-snap-abc/tree" },
    ]);
  });

  it("reports no worktrees for empty output", () => {
    expect(parseWorktreeListPorcelain({ text: "" })).toEqual([]);
  });
});

describe("findWorktreeForBranch", () => {
  const worktrees = parseWorktreeListPorcelain({ text: PORCELAIN });

  it("finds a worktree whose directory name does NOT match the branch or any slug guess", () => {
    // The exact live discovery this module exists for: the branch is `retrieval-passage-head`, the directory
    // is `passage-head-reserve` — neither the slug nor `worktree-<slug>` would have found it.
    const found = findWorktreeForBranch({
      candidates: ["retrieval-passage-head", "worktree-retrieval-passage-head"],
      worktrees,
    });

    expect(found!.path).toBe("/repo/slopweaver-fleet/passage-head-reserve");
  });

  it("returns undefined when no candidate branch has a worktree", () => {
    expect(findWorktreeForBranch({ candidates: ["never-existed"], worktrees })).toBeUndefined();
  });

  it("picks the earliest-listed worktree when more than one candidate has one", () => {
    expect(findWorktreeForBranch({ candidates: ["main", "retrieval-passage-head"], worktrees })!.branch).toBe("main");
  });
});

describe("findWorktreeAtPath", () => {
  const worktrees = parseWorktreeListPorcelain({ text: PORCELAIN });

  it("finds the worktree registered at a path regardless of the branch it holds", () => {
    const found = findWorktreeAtPath({ path: "/repo/slopweaver-fleet/passage-head-reserve", worktrees });

    expect(found!.branch).toBe("retrieval-passage-head");
  });

  it("finds a detached worktree too — a directory is registered whether or not a branch is", () => {
    const found = findWorktreeAtPath({ path: "/private/var/folders/tmp/slopweaver-snap-abc/tree", worktrees });

    expect(found!.branch).toBeNull();
  });

  it("matches after path normalisation, so a trailing slash or a `..` segment is not a different directory", () => {
    const found = findWorktreeAtPath({
      path: "/repo/slopweaver-fleet/../slopweaver-fleet/passage-head-reserve/",
      worktrees,
    });

    expect(found!.path).toBe("/repo/slopweaver-fleet/passage-head-reserve");
  });

  it("returns undefined when git lists nothing at that path", () => {
    expect(findWorktreeAtPath({ path: "/repo/slopweaver/.claude/worktrees/never-made", worktrees })).toBeUndefined();
  });
});

/** A real capture's shape: the `\r`-overwritten progress bar that was ALL a failed checkout's message contained. */
const PROGRESS_ONLY_STDERR =
  "Preparing worktree (new branch 'search-reindex-review')\n" +
  "Updating files:  88% (14007/15917)\rUpdating files:  89% (14167/15917)\rUpdating files:  90% (14326/15917)\r";

describe("summariseGitStderr", () => {
  it("drops the checkout progress bar and keeps the lines that actually say something", () => {
    expect(summariseGitStderr({ stderr: PROGRESS_ONLY_STDERR })).toBe(
      "Preparing worktree (new branch 'search-reindex-review')",
    );
  });

  it("keeps git's own error line after the progress noise", () => {
    const stderr = `${PROGRESS_ONLY_STDERR}fatal: unable to write file d1/f1.txt: No space left on device\n`;

    expect(summariseGitStderr({ stderr })).toBe(
      "Preparing worktree (new branch 'search-reindex-review'); fatal: unable to write file d1/f1.txt: No space left on device",
    );
  });

  it("is empty for an empty or progress-only capture", () => {
    expect(summariseGitStderr({ stderr: "" })).toBe("");
    expect(summariseGitStderr({ stderr: "Updating files:  50% (1/2)\rUpdating files: 100% (2/2)\r" })).toBe("");
  });
});

describe("describeGitWriteFailure", () => {
  const args = ["worktree", "add", "-b", "slug", "/wt/slug", "FETCH_HEAD"];

  it("says 'timed out' with the bound and how far the checkout had got when this module killed the process", () => {
    const message = describeGitWriteFailure({
      args,
      code: null,
      signal: "SIGKILL",
      stderr: PROGRESS_ONLY_STDERR,
      timedOut: true,
      timeoutMs: 600_000,
    });

    expect(message).toBe(
      "git worktree add -b slug /wt/slug FETCH_HEAD failed: timed out after 600s " +
        "(last output: Updating files:  90% (14326/15917))",
    );
  });

  it("reports git's own words when git exited non-zero on its own", () => {
    const message = describeGitWriteFailure({
      args,
      code: 128,
      signal: null,
      stderr: "fatal: '/wt/slug' already exists\n",
      timedOut: false,
      timeoutMs: 600_000,
    });

    expect(message).toBe("git worktree add -b slug /wt/slug FETCH_HEAD failed: fatal: '/wt/slug' already exists");
  });

  it("names the signal when something else killed git and it said nothing", () => {
    const message = describeGitWriteFailure({
      args,
      code: null,
      signal: "SIGTERM",
      stderr: "",
      timedOut: false,
      timeoutMs: 600_000,
    });

    expect(message).toBe("git worktree add -b slug /wt/slug FETCH_HEAD failed: killed by SIGTERM");
  });

  it("falls back to the exit code when git exited silently", () => {
    const message = describeGitWriteFailure({
      args,
      code: 1,
      signal: null,
      stderr: "",
      timedOut: false,
      timeoutMs: 600_000,
    });

    expect(message).toBe("git worktree add -b slug /wt/slug FETCH_HEAD failed: exit 1");
  });
});

describe("parseRemoteDefaultBranch", () => {
  it("reads the branch HEAD points at, from a real ls-remote --symref capture", () => {
    const text = ["ref: refs/heads/main\tHEAD", "7c6d1521a1b2c3d4e5f60718293a4b5c6d7e8f90\tHEAD"].join("\n");

    expect(parseRemoteDefaultBranch({ text })).toBe("main");
  });

  it("reads a non-main trunk branch name, since not every repo's default is called main", () => {
    const text = ["ref: refs/heads/v2-ada-owner-work-console\tHEAD"].join("\n");

    expect(parseRemoteDefaultBranch({ text })).toBe("v2-ada-owner-work-console");
  });

  it("reports undefined when the remote reported no symref for HEAD", () => {
    expect(parseRemoteDefaultBranch({ text: "" })).toBeUndefined();
  });
});

describe("createWorktree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it(
    "forks a brand-new branch from freshly-fetched origin/main, never from the main worktree's own stray " +
      "checkout or a stale cached remote ref — the exact live discovery this module exists for",
    () => {
      const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-origin-"));
      gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
      gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
      gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
      gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-A"], cwd: origin });

      // The shared main worktree — a real local clone whose remote-tracking ref is now STALE, and whose
      // own working directory is deliberately left checked out on a stray, unrelated branch (exactly the
      // observed real failure: a `voice-rules-enforcement`-shaped commit sitting checked out at spawn time).
      const local = mkdtempSync(join(tmpdir(), "slopweaver-createwt-local-"));
      gitInTemp({ args: ["clone", "-q", origin, local], cwd: tmpdir() });
      gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: local });
      gitInTemp({ args: ["config", "user.name", "Test"], cwd: local });
      gitInTemp({ args: ["checkout", "-q", "-b", "stray"], cwd: local });
      gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "stray-commit"], cwd: local });
      const strayHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: local });

      // Trunk advances on the remote AFTER the clone, so `local`'s cached `refs/remotes/origin/main` is now
      // stale — proving a fresh `fetch` actually ran, rather than the new worktree landing on a cached ref.
      gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-B"], cwd: origin });
      const originMainHead = gitInTemp({ args: ["rev-parse", "main"], cwd: origin });

      const newWorktree = join(mkdtempSync(join(tmpdir(), "slopweaver-createwt-new-")), "wt");
      createWorktree({ baseBranch: undefined, branch: "brand-new-feature", path: newWorktree, repoRoot: local });

      const newWorktreeHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: newWorktree });
      expect(newWorktreeHead).toBe(originMainHead);
      expect(newWorktreeHead).not.toBe(strayHead);
    },
  );

  it("checks out an EXISTING branch as-is, never re-forking it from trunk", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-existing-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-A"], cwd: origin });
    gitInTemp({ args: ["branch", "already-exists"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-B"], cwd: origin }); // advances main only

    const newWorktree = join(mkdtempSync(join(tmpdir(), "slopweaver-createwt-existing-wt-")), "wt");
    createWorktree({ baseBranch: undefined, branch: "already-exists", path: newWorktree, repoRoot: origin });

    const newWorktreeHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: newWorktree });
    const existingBranchHead = gitInTemp({ args: ["rev-parse", "already-exists"], cwd: origin });
    expect(newWorktreeHead).toBe(existingBranchHead);
  });

  it("leaves a worktree from the production create seam ignoring a cassette under a neutral name, with no .gitignore of its own", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-exclude-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-A"], cwd: origin });
    gitInTemp({ args: ["branch", "already-exists"], cwd: origin });

    const newWorktree = join(mkdtempSync(join(tmpdir(), "slopweaver-createwt-exclude-wt-")), "wt");
    productionProvisionDeps().create({
      baseBranch: undefined,
      branch: "already-exists",
      path: newWorktree,
      repoRoot: origin,
    });
    mkdirSync(join(newWorktree, "packages", "agent-cli", "cassettes"), { recursive: true });
    writeFileSync(join(newWorktree, "packages", "agent-cli", "cassettes", "verb-raises-a-pr.tape"), "Output x.gif\n");
    writeFileSync(join(newWorktree, "kept.md"), "a real change\n");

    const status = gitInTemp({ args: ["status", "--porcelain", "--untracked-files=all"], cwd: newWorktree });
    expect(status).toBe("?? kept.md");
    expect(existsSync(join(origin, ".gitignore"))).toBe(false);
  });

  it("forks a brand-new branch from a DECLARED base branch instead of trunk, when one is given", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-base-origin-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "trunk-A"], cwd: origin });
    gitInTemp({ args: ["checkout", "-q", "-b", "stacked-base"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "stacked-base-A"], cwd: origin });
    gitInTemp({ args: ["checkout", "-q", "main"], cwd: origin });
    const stackedBaseHead = gitInTemp({ args: ["rev-parse", "stacked-base"], cwd: origin });
    const trunkHead = gitInTemp({ args: ["rev-parse", "main"], cwd: origin });

    // `createWorktree` fetches from the `origin` REMOTE of the repo it is called against — a clone, so it has
    // one named `origin`, exactly like a real local checkout of this repository does.
    const local = mkdtempSync(join(tmpdir(), "slopweaver-createwt-base-local-"));
    gitInTemp({ args: ["clone", "-q", origin, local], cwd: tmpdir() });

    const newWorktree = join(mkdtempSync(join(tmpdir(), "slopweaver-createwt-base-wt-")), "wt");
    createWorktree({
      baseBranch: "stacked-base",
      branch: "on-top-of-stacked",
      path: newWorktree,
      repoRoot: local,
    });

    const newWorktreeHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: newWorktree });
    expect(newWorktreeHead).toBe(stackedBaseHead);
    expect(newWorktreeHead).not.toBe(trunkHead);
  });

  it("throws rather than silently falling back to trunk when the declared base branch does not exist on the remote", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-missing-base-origin-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "trunk-A"], cwd: origin });

    const local = mkdtempSync(join(tmpdir(), "slopweaver-createwt-missing-base-local-"));
    gitInTemp({ args: ["clone", "-q", origin, local], cwd: tmpdir() });

    const newWorktree = join(mkdtempSync(join(tmpdir(), "slopweaver-createwt-missing-base-wt-")), "wt");

    expect(() =>
      createWorktree({
        baseBranch: "does-not-exist-anywhere",
        branch: "on-top-of-nothing",
        path: newWorktree,
        repoRoot: local,
      }),
    ).toThrow();
  });

  it("refuses, naming the fix, when a directory already sits at the path but git does not list it as a worktree", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-leftover-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-A"], cwd: origin });
    gitInTemp({ args: ["branch", "already-exists"], cwd: origin });

    // The partial directory a killed checkout left behind.
    const leftover = join(mkdtempSync(join(tmpdir(), "slopweaver-createwt-leftover-wt-")), "wt");
    mkdirSync(leftover);

    expect(() =>
      createWorktree({ baseBranch: undefined, branch: "already-exists", path: leftover, repoRoot: origin }),
    ).toThrow(`${leftover} already exists but git does not list it as a worktree of ${origin}`);
    // Only the main checkout — nothing was registered. (Counted, not path-compared: git prints the realpath,
    // and on macOS the temp dir is a symlink.)
    expect(listWorktrees({ repoRoot: origin }).length).toBe(1);
  });

  it("deletes the branch it created and the directory it started when the add itself dies — no dangling `-b` branch", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-cleanup-origin-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-A"], cwd: origin });
    const local = mkdtempSync(join(tmpdir(), "slopweaver-createwt-cleanup-local-"));
    gitInTemp({ args: ["clone", "-q", origin, local], cwd: tmpdir() });

    // git creates the `-b` branch BEFORE it makes the directory, so a parent it cannot write into reproduces
    // exactly the observed shape: the add fails, and the branch is left pointing at FETCH_HEAD.
    const parent = mkdtempSync(join(tmpdir(), "slopweaver-createwt-cleanup-parent-"));
    chmodSync(parent, 0o555);
    try {
      expect(() =>
        createWorktree({ baseBranch: undefined, branch: "died-midway", path: join(parent, "wt"), repoRoot: local }),
      ).toThrow("git worktree add --no-checkout -b died-midway");
    } finally {
      chmodSync(parent, 0o755);
    }

    expect(gitInTemp({ args: ["branch", "--list", "died-midway"], cwd: local })).toBe("");
    expect(existsSync(join(parent, "wt"))).toBe(false);
    expect(listWorktrees({ repoRoot: local }).map((worktree) => worktree.path).length).toBe(1);
  });

  it("kills an add that outruns its bound, says so, and leaves nothing behind", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-createwt-silent-"));
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-A"], cwd: origin });
    gitInTemp({ args: ["branch", "already-exists"], cwd: origin });
    const path = join(mkdtempSync(join(tmpdir(), "slopweaver-createwt-silent-wt-")), "wt");

    // A 1ms bound is one no real git process finishes inside — the bound is the subject here, not git's speed.
    expect(() =>
      createWorktree({ baseBranch: undefined, branch: "already-exists", path, repoRoot: origin, timeoutMs: 1 }),
    ).toThrow("timed out after 0s");

    expect(existsSync(path)).toBe(false);
    expect(listWorktrees({ repoRoot: origin }).length).toBe(1);
    // The branch existed before, so it must NOT have been deleted — cleanup only removes what the add created.
    expect(gitInTemp({ args: ["branch", "--list", "already-exists"], cwd: origin })).toBe("already-exists");
  });
});

describe("resetWorktreeToFreshTrunk", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      rmSync(cleanupDirs.pop()!, { force: true, recursive: true });
    }
  });

  it(
    "resets a REUSED worktree onto freshly-fetched trunk, discarding whatever commit the branch was left on " +
      "— the exact fix for a per-recipe child worktree that otherwise runs the day-one commit forever",
    () => {
      const origin = mkdtempSync(join(tmpdir(), "slopweaver-resyncwt-origin-"));
      cleanupDirs.push(origin);
      gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
      gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
      gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
      gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-A"], cwd: origin });

      const local = mkdtempSync(join(tmpdir(), "slopweaver-resyncwt-local-"));
      cleanupDirs.push(local);
      gitInTemp({ args: ["clone", "-q", origin, local], cwd: tmpdir() });
      gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: local });
      gitInTemp({ args: ["config", "user.name", "Test"], cwd: local });

      // Provision the reused worktree exactly as a first recipe generation would, then let it drift: a local
      // commit no other generation should see, while trunk itself keeps moving on the remote.
      const worktreeParent = mkdtempSync(join(tmpdir(), "slopweaver-resyncwt-wt-"));
      cleanupDirs.push(worktreeParent);
      const worktree = join(worktreeParent, "wt");
      createWorktree({ baseBranch: undefined, branch: "recipe-child/knock-alerts", path: worktree, repoRoot: local });
      gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "stale-child-commit"], cwd: worktree });
      const staleHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: worktree });

      gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "orig-B"], cwd: origin });
      const freshTrunkHead = gitInTemp({ args: ["rev-parse", "main"], cwd: origin });

      resetWorktreeToFreshTrunk({ baseBranch: undefined, path: worktree, repoRoot: local });

      const resyncedHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: worktree });
      expect(resyncedHead).toBe(freshTrunkHead);
      expect(resyncedHead).not.toBe(staleHead);
    },
  );

  it("resets onto a DECLARED base branch instead of trunk, when one is given", () => {
    const origin = mkdtempSync(join(tmpdir(), "slopweaver-resyncwt-base-origin-"));
    cleanupDirs.push(origin);
    gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: origin });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: origin });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "trunk-A"], cwd: origin });
    gitInTemp({ args: ["checkout", "-q", "-b", "stacked-base"], cwd: origin });
    gitInTemp({ args: ["commit", "-q", "--allow-empty", "-m", "stacked-base-A"], cwd: origin });
    gitInTemp({ args: ["checkout", "-q", "main"], cwd: origin });
    const stackedBaseHead = gitInTemp({ args: ["rev-parse", "stacked-base"], cwd: origin });
    const trunkHead = gitInTemp({ args: ["rev-parse", "main"], cwd: origin });

    const local = mkdtempSync(join(tmpdir(), "slopweaver-resyncwt-base-local-"));
    cleanupDirs.push(local);
    gitInTemp({ args: ["clone", "-q", origin, local], cwd: tmpdir() });
    gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: local });
    gitInTemp({ args: ["config", "user.name", "Test"], cwd: local });

    const worktreeParent = mkdtempSync(join(tmpdir(), "slopweaver-resyncwt-base-wt-"));
    cleanupDirs.push(worktreeParent);
    const worktree = join(worktreeParent, "wt");
    createWorktree({ baseBranch: undefined, branch: "recipe-child/knock-alerts", path: worktree, repoRoot: local });
    writeFileSync(join(worktree, "drift.txt"), "not on any branch this recipe should track\n");
    gitInTemp({ args: ["add", "drift.txt"], cwd: worktree });
    gitInTemp({ args: ["commit", "-q", "-m", "drift"], cwd: worktree });

    resetWorktreeToFreshTrunk({ baseBranch: "stacked-base", path: worktree, repoRoot: local });

    const resyncedHead = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: worktree });
    expect(resyncedHead).toBe(stackedBaseHead);
    expect(resyncedHead).not.toBe(trunkHead);
  });
});
