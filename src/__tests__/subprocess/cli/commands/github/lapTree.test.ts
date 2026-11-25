/**
 * `checkoutLapTree` over real git: the lap's detached checkout is made under the parent it is handed — in
 * production the cache root's `lap-trees.noindex`, outside the per-user temp directory macOS's daily `dirhelper`
 * empties — registered as a worktree of the seat's repository, and gone again, directory and registration both,
 * once disposed. `gitInTemp` per `src/__tests__/tempGitRepo.ts` builds every fixture.
 */
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkoutLapTree } from "../../../../../cli/commands/github/lapTree.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readLapTreeMarker } from "../../../../../worktree/lapTreeProvenance.js";
import { gitInTemp, REAL_GIT_SUITE } from "../../../../tempGitRepo.js";

const fixtureDirs: string[] = [];

/** A minter `ps` stamped: this test process's own pid, with a fixed stamp the marker must carry verbatim. */
const MINTER = { pid: process.pid, processStart: "Thu Nov 26 09:00:00 2026" };

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fixture root holding a repository on `main` with one commit, and that commit's sha. */
function initRepo(): { root: string; repo: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), "lap-tree-"));
  fixtureDirs.push(root);
  const repo = join(root, "repo");
  gitInTemp({ args: ["init", "-q", "-b", "main", repo], cwd: root });
  gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: repo });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: repo });
  writeFileSync(join(repo, "file.txt"), "one\n");
  gitInTemp({ args: ["add", "-A"], cwd: repo });
  gitInTemp({ args: ["commit", "-q", "-m", "root"], cwd: repo });
  return { repo, root, sha: gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo }) };
}

/** Every worktree path the repository has registered, as `git worktree list --porcelain` prints it. */
function registeredWorktrees({ repo }: { repo: string }): readonly string[] {
  return gitInTemp({ args: ["worktree", "list", "--porcelain"], cwd: repo })
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

describe("checkoutLapTree", REAL_GIT_SUITE, () => {
  it("checks the sha out under the parent it is given, creating the parent, and disposes tree and registration", async () => {
    const { repo, root, sha } = initRepo();
    const parent = join(root, "cache", "lap-trees.noindex");
    expect(existsSync(parent)).toBe(false);

    const tree = unwrap(checkoutLapTree({ cwd: repo, minter: MINTER, resolveParent: () => parent, sha }));
    const physical = realpathSync(tree.value);
    const gitDir = gitInTemp({ args: ["rev-parse", "--absolute-git-dir"], cwd: tree.value });
    try {
      expect(dirname(tree.value)).toBe(parent);
      expect(basename(tree.value).startsWith("sw-lap-")).toBe(true);
      expect(gitInTemp({ args: ["rev-parse", "HEAD"], cwd: tree.value })).toBe(sha);
      expect(registeredWorktrees({ repo })).toContain(physical);
      expect(unwrap(readLapTreeMarker({ gitDir }))).toEqual({
        kind: "github-lap-tree",
        mintedHead: sha,
        pid: process.pid,
        processStart: "Thu Nov 26 09:00:00 2026",
        version: 1,
      });
      // The marker sits in the private gitdir, so the tree's own status never sees it.
      expect(gitInTemp({ args: ["status", "--porcelain", "--ignored"], cwd: tree.value })).toBe("");
    } finally {
      await tree.dispose();
    }

    expect(existsSync(tree.value)).toBe(false);
    expect(existsSync(gitDir)).toBe(false);
    expect(registeredWorktrees({ repo })).not.toContain(physical);
    expect(existsSync(parent)).toBe(true);
  });

  it("refuses a minter ps could not stamp before creating anything", () => {
    const { repo, root, sha } = initRepo();
    const parent = join(root, "cache", "lap-trees.noindex");

    const failure = unwrapErr(
      checkoutLapTree({ cwd: repo, minter: { pid: 4242, processStart: undefined }, resolveParent: () => parent, sha }),
    );

    expect(failure.code).toBe("COMMAND_FAILED");
    expect(failure.message).toContain("ps printed no start time for pid 4242");
    expect(existsSync(parent)).toBe(false);
    expect(registeredWorktrees({ repo })).toEqual([realpathSync(repo)]);
  });

  it("answers a typed failure naming the lap-tree directory when the parent cannot be created", () => {
    const { repo, root, sha } = initRepo();
    const parent = join(root, "a-file");
    writeFileSync(parent, "not a directory\n");

    const failure = unwrapErr(checkoutLapTree({ cwd: repo, minter: MINTER, resolveParent: () => parent, sha }));

    expect(failure.code).toBe("COMMAND_FAILED");
    expect(failure.message).toContain(`create the lap tree under ${parent} failed: `);
    expect(registeredWorktrees({ repo })).toEqual([realpathSync(repo)]);
  });

  it("answers a typed failure, creating nothing, when the parent cannot be resolved", () => {
    const { repo, root, sha } = initRepo();
    const unresolvable = (): string => {
      throw new Error("cache root: SLOPWEAVER_CACHE_HOME carries a control character");
    };

    const failure = unwrapErr(checkoutLapTree({ cwd: repo, minter: MINTER, resolveParent: unresolvable, sha }));

    expect(failure.code).toBe("COMMAND_FAILED");
    expect(failure.message).toBe(
      "create the lap tree under the lap-tree parent failed: cache root: SLOPWEAVER_CACHE_HOME carries a control character",
    );
    expect(registeredWorktrees({ repo })).toEqual([realpathSync(repo)]);
    expect(readdirSync(root)).toEqual(["repo"]);
  });
});
