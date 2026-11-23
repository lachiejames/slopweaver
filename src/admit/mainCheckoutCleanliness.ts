/**
 * Reports whether a repository's own main checkout is currently dirty — the loud, early surfacing half of
 * the cross-tool coverage this guard family provides. Read by `slopweaver doctor`, which every Claude Code
 * `SessionStart` hook already runs (see `hooks/hooks.json`). Nothing here BLOCKS anything; it only reports,
 * because an interactive Codex session's raw file edit is invisible to every guard in this directory until
 * it either gets committed (`mainCheckoutCommitGuard.ts`) or someone happens to look — this is that
 * "someone happens to look", run automatically rather than left to chance.
 */
import { execFileSync } from "node:child_process";

import { gitEnv } from "../lib/gitRepo.js";
import { isMainWorktree } from "./mainWorktree.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** One `git status --porcelain` line's worth of change (staged, unstaged, or untracked). */
export interface MainCheckoutCleanliness {
  readonly dirty: boolean;
  readonly entries: number;
}

/**
 * The main checkout's cleanliness, reported only when `cwd` resolves to a repository's OWN main worktree.
 * `undefined` for any other `cwd` (a linked worktree, not a git repository, or a `git status` that errors)
 * so a caller can omit the line entirely rather than print a false status about an unrelated directory.
 *
 * @param cwd the directory to check
 * @returns the cleanliness, or undefined when `cwd` is not resolvably a repository's main worktree
 */
export function mainCheckoutCleanliness({ cwd }: { cwd: string }): MainCheckoutCleanliness | undefined {
  if (!isMainWorktree({ cwd })) {
    return undefined;
  }
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    const entries = output.split("\n").filter((line) => line.trim().length > 0).length;
    return { dirty: entries > 0, entries };
  } catch {
    return undefined; // ambiguous — never assert a status this cannot confirm
  }
}
