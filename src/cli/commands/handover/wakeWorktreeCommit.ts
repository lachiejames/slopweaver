/**
 * The commit a parked seat's worktree stands on, and whether anything sits beside it uncommitted — what `handover
 * wake`'s question pass compares with a merged pull request's head commit before it calls that pull request the
 * run's whole work. A branch NAME outlives a merge: a commit made on it afterwards keeps every
 * name equal while the worktree holds work the merge never carried.
 *
 * One `git status --porcelain=v2 --branch` gives both halves at once, bounded like the wake's branch read, with the
 * merge proof's config pinned (`./wakeMergeProof.ts`'s `STATUS_ARGS`) and its index blind-spot read on both sides:
 * a file the index tells git not to check, or a submodule, reads dirty, since status cannot vouch for either.
 */
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { runGitChecked } from "../../../codex/gitRun.js";
import { indexBlind, STATUS_ARGS } from "./wakeMergeProof.js";

/** A worktree's commit, the branch `HEAD` names, and whether it carries a change or untracked file beside it. */
export interface WorktreeCommit {
  readonly oid: string;
  /** `# branch.head`'s value: a branch name, or `(detached)` mid-rebase, mid-bisect or on any detached `HEAD`. */
  readonly branch: string;
  readonly dirty: boolean;
}

/** The git child did not run, timed out or failed: a missing worktree lands here. */
export interface WorktreeUnreadableError {
  readonly code: "WORKTREE_UNREADABLE";
  readonly message: string;
}

/** `git status` named no commit for `HEAD`: a branch with no commit yet, or output with no `# branch.oid`. */
export interface WorktreeNoCommitError {
  readonly code: "WORKTREE_NO_COMMIT";
  readonly message: string;
  /** The header's value as read, `undefined` when there was none. */
  readonly oid: string | undefined;
}

/** `git status` printed no `# branch.head` header. */
export interface WorktreeNoBranchError {
  readonly code: "WORKTREE_NO_BRANCH";
  readonly message: string;
}

/** Why a worktree's commit did not read. */
export type WorktreeCommitError = WorktreeNoBranchError | WorktreeNoCommitError | WorktreeUnreadableError;

/** The {@link WorktreeCommitError} factories. */
export const WorktreeCommitErrors = {
  noBranch: (): WorktreeNoBranchError => ({
    code: "WORKTREE_NO_BRANCH",
    message: "git status named no branch for HEAD",
  }),
  noCommit: ({ oid }: { oid: string | undefined }): WorktreeNoCommitError => ({
    code: "WORKTREE_NO_COMMIT",
    message: `git status named no commit for HEAD (${String(oid)})`,
    oid,
  }),
  unreadable: ({ message }: { message: string }): WorktreeUnreadableError => ({
    code: "WORKTREE_UNREADABLE",
    message,
  }),
} as const;

/** One `# branch.<key> <value>` header's value, or `undefined` when the output carries none. */
function headerValue({ key, lines }: { key: string; lines: readonly string[] }): string | undefined {
  const prefix = `# branch.${key} `;
  return lines
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

/**
 * Parse `git status --porcelain=v2 --branch` into the commit HEAD names, its branch, and whether any entry sits
 * beside it.
 *
 * @param output the command's whole stdout
 * @returns the commit, branch and dirtiness, or why the output names no commit (a branch with no commit yet) or no
 *   branch header
 */
export function parseWorktreeStatus({ output }: { output: string }): Result<WorktreeCommit, WorktreeCommitError> {
  const lines = output.split("\n").filter((line) => line.length > 0);
  const oid = headerValue({ key: "oid", lines });
  if (oid === undefined || !/^[0-9a-f]{40,64}$/u.test(oid)) {
    return err(WorktreeCommitErrors.noCommit({ oid }));
  }
  const branch = headerValue({ key: "head", lines });
  if (branch === undefined) {
    return err(WorktreeCommitErrors.noBranch());
  }
  return ok({ branch, dirty: lines.some((line) => !line.startsWith("# ")), oid });
}

/**
 * Read a worktree's commit and dirtiness, bounded by `timeoutMs`.
 *
 * @param cwd the parked seat's worktree
 * @param timeoutMs the bound on the one git child
 * @returns the commit and its dirtiness, or why it did not read — a missing worktree included
 */
export function readWorktreeCommit({
  cwd,
  timeoutMs,
}: {
  cwd: string;
  timeoutMs: number;
}): Result<WorktreeCommit, WorktreeCommitError> {
  const before = indexBlind({ dir: cwd });
  if (before.isErr()) {
    return err(WorktreeCommitErrors.unreadable({ message: before.error.message }));
  }
  const output = safeFs({
    execute: () =>
      runGitChecked({
        // The merge proof's own status read, never left to config: `status.showUntrackedFiles=no`, a submodule's
        // `ignore` or an fsmonitor hook answering "nothing changed" would each
        // hide work the merge never carried, and the worktree would read clean.
        args: [...STATUS_ARGS],
        cwd,
        label: "git status --porcelain=v2 --branch --untracked-files=all (config pinned)",
        timeoutMs,
      }),
    operation: "handover.wakeWorktreeCommit",
  });
  if (output.isErr()) {
    return err(WorktreeCommitErrors.unreadable({ message: output.error.message }));
  }
  const after = indexBlind({ dir: cwd });
  if (after.isErr()) {
    return err(WorktreeCommitErrors.unreadable({ message: after.error.message }));
  }
  // A file the index tells git not to check, or a submodule, is one status cannot vouch for: read on both sides of
  // the status, either makes the tree unprovable, which reads dirty so the row stays due (`./wakeMergeProof.ts`).
  const blind = before.value !== undefined || after.value !== undefined;
  return parseWorktreeStatus({ output: output.value }).map((read) => ({ ...read, dirty: read.dirty || blind }));
}
