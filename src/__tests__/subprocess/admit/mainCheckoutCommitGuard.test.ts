/**
 * {@link evaluateMainCheckoutCommitGuard}. `checkMainWorktree` is a real filesystem round-trip against a
 * real repo + a real linked worktree for the resolution cases; the block/allow/override decision is
 * exercised with an injected checker, matching `mainCheckoutBranchGuard.test.ts`'s own split.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateMainCheckoutCommitGuard } from "../../../admit/mainCheckoutCommitGuard.js";
import { MAIN_CHECKOUT_WRITE_OVERRIDE_ENV } from "../../../admit/mainCheckoutDirtyGuard.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A real repo (its own `.git` directory) plus one real linked worktree, in a fresh temp dir. */
function realRepoWithWorktree(): { main: string; linked: string } {
  const main = mkdtempSync(join(tmpdir(), "slopweaver-commit-guard-main-"));
  fixtureDirs.push(main);
  gitInTemp({ args: ["init", "-q", "-b", "main"], cwd: main });
  gitInTemp({ args: ["config", "user.email", "test@example.com"], cwd: main });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: main });
  gitInTemp({ args: ["commit", "--allow-empty", "-q", "-m", "root"], cwd: main });
  const linkedRoot = mkdtempSync(join(tmpdir(), "slopweaver-commit-guard-linked-"));
  fixtureDirs.push(linkedRoot);
  const linked = join(linkedRoot, "wt");
  gitInTemp({ args: ["worktree", "add", "-q", "-b", "feature", linked], cwd: main });
  return { linked, main };
}

describe("evaluateMainCheckoutCommitGuard", () => {
  const checkMainWorktree = (): boolean => true;

  it("blocks a commit in the main checkout", () => {
    const decision = evaluateMainCheckoutCommitGuard({ allowOverride: false, checkMainWorktree, cwd: "/anywhere" });
    if (!decision.block) {
      throw new Error("expected blocked");
    }
    expect(decision.message).toContain(MAIN_CHECKOUT_WRITE_OVERRIDE_ENV);
  });

  it("allows a commit when it is not the main worktree", () => {
    expect(
      evaluateMainCheckoutCommitGuard({ allowOverride: false, checkMainWorktree: () => false, cwd: "/anywhere" }),
    ).toEqual({ block: false });
  });

  it("allows under the override", () => {
    expect(evaluateMainCheckoutCommitGuard({ allowOverride: true, checkMainWorktree, cwd: "/anywhere" })).toEqual({
      block: false,
    });
  });

  it("blocks a real commit resolved against a real main checkout", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { main } = realRepoWithWorktree();
    expect(evaluateMainCheckoutCommitGuard({ allowOverride: false, cwd: main }).block).toBe(true);
  });

  it("allows a real commit resolved against a real linked worktree", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
    const { linked } = realRepoWithWorktree();
    expect(evaluateMainCheckoutCommitGuard({ allowOverride: false, cwd: linked })).toEqual({ block: false });
  });
});
