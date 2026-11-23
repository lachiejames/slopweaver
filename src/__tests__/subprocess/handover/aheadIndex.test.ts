/**
 * The per-repository ahead index, against real git.
 *
 * This is the equivalence the whole `handover list` speed fix rests on: one `for-each-ref` must answer what
 * N `rev-list --count` calls answered, INCLUDING git's own ref precedence. Asserting it against a live
 * repository is the only way to catch the day git changes what `%(ahead-behind:…)` means, or the day this
 * repository's git is too old to have it at all — the fallback path is exercised here too, by the same
 * assertions, because both roads must arrive at the same number.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { aheadFromIndex, commitsAhead, repoAheadIndex } from "../../../handover/evaluate.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One commit on the current branch, named so a failure says which one it was. */
function commit({ repo, name }: { repo: string; name: string }): void {
  writeFileSync(join(repo, `${name}.txt`), name, "utf8");
  gitInTemp({ args: ["add", "."], cwd: repo });
  gitInTemp({ args: ["commit", "-m", name], cwd: repo });
}

/**
 * A repository on `main` with one commit, plus whatever branches the caller asks for, each carrying one
 * commit of its own.
 */
function repoWith({ branches }: { branches: readonly string[] }): string {
  const repo = mkdtempSync(join(tmpdir(), "sw-ahead-"));
  fixtures.push(repo);
  gitInTemp({ args: ["init", "--initial-branch", "main"], cwd: repo });
  gitInTemp({ args: ["config", "user.email", "t@example.com"], cwd: repo });
  gitInTemp({ args: ["config", "user.name", "t"], cwd: repo });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: repo });
  commit({ name: "base", repo });
  for (const branch of branches) {
    gitInTemp({ args: ["checkout", "-b", branch], cwd: repo });
    commit({ name: branch, repo });
    gitInTemp({ args: ["checkout", "main"], cwd: repo });
  }
  return repo;
}

describe("repoAheadIndex against real git", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("counts a branch's commits ahead of the base", () => {
    const repo = repoWith({ branches: ["atlas"] });

    const index = repoAheadIndex({ base: "refs/heads/main", repo });

    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(1);
  });

  it("answers exactly what commitsAhead answers, which is what a caller actually holds", () => {
    const repo = repoWith({ branches: ["atlas", "worktree-atlas"] });
    gitInTemp({ args: ["checkout", "worktree-atlas"], cwd: repo });
    commit({ name: "second", repo });
    gitInTemp({ args: ["checkout", "main"], cwd: repo });

    expect(commitsAhead({ base: "refs/heads/main", candidates: ["atlas", "worktree-atlas"], repo })).toBe(2);
  });

  /**
   * `rev-list main..atlas` resolves `atlas` as a TAG before a branch, so an index that looked heads up first
   * would silently answer a different number here. This is the one case where getting the transcription of
   * `gitrevisions` wrong is invisible in every other test.
   */
  it("prefers a tag over a branch of the same name, exactly as the rev-list it replaced did", () => {
    const repo = repoWith({ branches: ["atlas"] });
    // The tag points at the base commit, so it is 0 ahead while the branch of the same name is 1 ahead.
    gitInTemp({ args: ["tag", "atlas", "refs/heads/main"], cwd: repo });

    const index = repoAheadIndex({ base: "refs/heads/main", repo });

    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(0);
  });

  it("is 0 for a branch that does not exist", () => {
    const repo = repoWith({ branches: ["atlas"] });

    const index = repoAheadIndex({ base: "refs/heads/main", repo });

    expect(aheadFromIndex({ candidates: ["no-such-branch-4b21c7"], index })).toBe(0);
  });

  it("reports no trunk, and therefore 0, for a repository with no origin and no explicit base", () => {
    const repo = repoWith({ branches: ["atlas"] });

    const index = repoAheadIndex({ base: undefined, repo });

    expect(index.trunk).toBeUndefined();
    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(0);
  });

  it("scoped to its candidates, counts them exactly and walks no other ref", () => {
    const repo = repoWith({ branches: ["atlas", "unrelated"] });

    const index = repoAheadIndex({ base: "refs/heads/main", candidates: ["atlas", "worktree-atlas"], repo });

    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(1);
    expect([...index.byRef!.keys()]).toEqual(["refs/heads/atlas"]);
  });

  it("scoped, still prefers a tag over a branch of the same name", () => {
    const repo = repoWith({ branches: ["atlas"] });
    gitInTemp({ args: ["tag", "atlas", "refs/heads/main"], cwd: repo });

    const index = repoAheadIndex({ base: "refs/heads/main", candidates: ["atlas"], repo });

    expect(aheadFromIndex({ candidates: ["atlas"], index })).toBe(0);
  });

  /** `for-each-ref --stdin` given no pattern lists every ref, so an empty scope must never reach git. */
  it("scoped to no candidates, is an empty index rather than every ref", () => {
    const repo = repoWith({ branches: ["atlas"] });

    const index = repoAheadIndex({ base: "refs/heads/main", candidates: [], repo });

    expect(index.byRef!.size).toBe(0);
  });

  /**
   * The fallback road. `byRef: undefined` is what an ahead-behind-less git leaves behind, and it must reach
   * the same number by shelling out per candidate — otherwise the fix would be a silent behaviour change on
   * any machine running git older than 2.41.
   */
  it("falls back to per-candidate rev-list and reaches the same count", () => {
    const repo = repoWith({ branches: ["atlas"] });

    expect(aheadFromIndex({ candidates: ["atlas"], index: { byRef: undefined, repo, trunk: "refs/heads/main" } })).toBe(
      1,
    );
  });
});
