/**
 * Reading and retiring worktrees — the `list`, `status` and `remove` half of the `worktree` noun.
 *
 * Everything git-shaped is read once and handed to pure rules, the same split `checkouts/inspect.ts` uses.
 * A read that FAILS is never folded into a green verdict: a worktree whose dependency state could not be
 * measured reports `unmeasurable`, which `depsAreTrustworthy` treats as untrustworthy.
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

import { absentAs } from "#lib/absent.js";
import { sleepSync } from "#lib/sleepSync.js";
import { listWorktrees } from "../cmux/worktree.js";
import type { WorktreeInfo } from "../cmux/worktreeList.js";
import { gitEnv } from "../lib/gitRepo.js";
import { err, ok, type Result } from "../lib/result.js";
import { deleteLeaseRoot, GIT_LEASE_WAIT_MS, withDeleteLease } from "./deleteLease.js";
import { type DepsStatus, depsStatus, renderDepsStatus } from "./deps.js";
import { withDepsLock } from "./depsLock.js";
import { type WorktreeError, WorktreeErrors } from "./errors.js";
import { readDepsFacts } from "./provision.js";
import { sharedDepsRoot } from "./shell.js";

/** How long a `git worktree remove` may run. A removal is an unlink sweep, not a checkout. */
const REMOVE_TIMEOUT_MS = 120_000;

/**
 * One worktree as `worktree list` reports it.
 *
 * @internal
 */
export interface WorktreeRow {
  /** The directory name — the slug a caller addresses it by. */
  readonly slug: string;
  /** The worktree's absolute path. */
  readonly path: string;
  /** The branch checked out there, or `null` for a detached HEAD. */
  readonly branch: string | null;
  /** Whether this row is the main checkout rather than a linked worktree. */
  readonly isMain: boolean;
}

/**
 * Turn git's own worktree list into addressable rows.
 *
 * Pure, so the main-checkout-first convention git guarantees is pinned by a fixture rather than assumed.
 *
 * @param worktrees the repository's worktrees, in the order git printed them
 * @returns one row per worktree, main checkout first, exactly as git ordered them
 */
export function worktreeRows({ worktrees }: { worktrees: readonly WorktreeInfo[] }): readonly WorktreeRow[] {
  return worktrees.map((worktree, index) => ({
    branch: worktree.branch,
    isMain: index === 0,
    path: worktree.path,
    slug: basename(worktree.path),
  }));
}

/**
 * The row a caller's slug names, matched on the directory name and then on the branch.
 *
 * @param rows every worktree of the repository
 * @param slug what the caller typed
 * @returns the matching row, or `undefined` when nothing answers to it
 */
export function findRow({ rows, slug }: { rows: readonly WorktreeRow[]; slug: string }): WorktreeRow | undefined {
  const found = rows.find((row) => row.slug === slug);
  if (found === undefined) {
    return rows.find((row) => row.branch === slug);
  }
  return found;
}

/**
 * One worktree's full status: where it is, what it holds, and whether its dependencies can be trusted.
 *
 * @internal
 */
export interface WorktreeStatus {
  /** The row this status describes. */
  readonly row: WorktreeRow;
  /** How `node_modules` stands against this worktree's own manifests. */
  readonly deps: DepsStatus;
  /** How far behind its base the branch is, or `undefined` when that could not be measured. */
  readonly behind: number | undefined;
  /** The ref {@link behind} was measured against. */
  readonly base: string | undefined;
}

/** The read seams `status` needs, injected so a test never shells out. */
export interface WorktreeReadDeps {
  /** Every worktree git currently registers. */
  readonly worktrees: (args: { repoRoot: string }) => readonly WorktreeInfo[];
  /** Run one git read, returning trimmed stdout or `undefined` when the call failed. */
  readonly git: (args: { args: readonly string[]; cwd: string }) => string | undefined;
  /** How `node_modules` stands in one worktree. */
  readonly deps: (args: { path: string }) => DepsStatus;
}

/**
 * The real seams: git subprocesses and a filesystem read of `node_modules`.
 *
 * @returns the production {@link WorktreeReadDeps}
 */
export function productionReadDeps(): WorktreeReadDeps {
  return {
    deps: ({ path }) => depsStatus({ facts: readDepsFacts({ path, sharedRoot: sharedDepsRoot() }) }),
    git: ({ args, cwd }) => {
      try {
        return execFileSync("git", [...args], {
          cwd,
          encoding: "utf8",
          env: gitEnv(),
          // Discarded with the error, for the same reason `worktree/shell.ts`'s read discards it: this seam
          // reports a failed read as `undefined`, so git's stderr would print an error for an answer.
          stdio: ["ignore", "pipe", "ignore"],
          timeout: REMOVE_TIMEOUT_MS,
        }).trim();
      } catch {
        return undefined;
      }
    },
    worktrees: ({ repoRoot }) => listWorktrees({ repoRoot }),
  };
}

/** How many commits `base` carries that this worktree's branch does not, parsed from `rev-list --count`. */
function behindCount({ text }: { text: string | undefined }): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(text.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Measure one worktree: its row, its dependency state, and how far its branch has fallen behind its base.
 *
 * @param repoRoot the repository the worktree belongs to
 * @param slug what the caller typed
 * @param base the ref freshness is measured against
 * @param deps the injected read seams
 * @returns the status, or `WORKTREE_NOT_FOUND` when no worktree answers to the slug
 */
export function worktreeStatus({
  repoRoot,
  slug,
  base,
  deps,
}: {
  repoRoot: string;
  slug: string;
  base: string;
  deps: WorktreeReadDeps;
}): Result<WorktreeStatus, WorktreeError> {
  const rows = worktreeRows({ worktrees: deps.worktrees({ repoRoot }) });
  const row = findRow({ rows, slug });
  if (row === undefined) {
    return err(WorktreeErrors.notFound({ slug }));
  }
  return ok({
    base,
    behind: behindCount({ text: deps.git({ args: ["rev-list", "--count", `HEAD..${base}`], cwd: row.path }) }),
    deps: deps.deps({ path: row.path }),
    row,
  });
}

/**
 * The branch line's value. git lists no branch for a worktree whose HEAD is detached, so `status` names that
 * state rather than a branch.
 */
function statusBranchLabel({ row }: { row: WorktreeRow }): string {
  const { branch } = row;
  if (branch === null) {
    return "(detached HEAD)";
  }
  return branch;
}

/**
 * The lines `worktree status` prints.
 *
 * @param status the measured worktree
 * @returns one line per fact, the branch and path first
 */
export function renderWorktreeStatus({ status }: { status: WorktreeStatus }): readonly string[] {
  const behind =
    status.behind === undefined
      ? `  base: ${absentAs({ value: status.base, whenAbsent: "unknown" })} — drift could not be measured`
      : `  base: ${String(status.behind)} commit(s) behind ${absentAs({ value: status.base, whenAbsent: "unknown" })}`;
  return [
    `${status.row.slug}: ${status.row.path}`,
    `  branch: ${statusBranchLabel({ row: status.row })}`,
    behind,
    `  ${renderDepsStatus({ status: status.deps })}`,
  ];
}

/**
 * Remove one worktree, and the directory with it.
 *
 * `--force` is passed straight through to git rather than interpreted here: git's own refusal on a dirty
 * worktree is the safety property, and re-implementing it would be a second, weaker copy of it.
 *
 * @param repoRoot the repository the worktree belongs to
 * @param slug what the caller typed
 * @param force whether to remove a worktree with uncommitted changes
 * @param deps the injected read seams
 * @returns the removed row, or the typed failure
 */
export function removeWorktree({
  repoRoot,
  slug,
  force,
  deps,
}: {
  repoRoot: string;
  slug: string;
  force: boolean;
  deps: WorktreeReadDeps;
}): Result<WorktreeRow, WorktreeError> {
  const rows = worktreeRows({ worktrees: deps.worktrees({ repoRoot }) });
  const row = findRow({ rows, slug });
  if (row === undefined) {
    return err(WorktreeErrors.notFound({ slug }));
  }
  if (row.isMain) {
    return err(
      WorktreeErrors.requestInvalid({
        problems: [`${row.path} is the main checkout, not a worktree — it is never this verb's to remove`],
      }),
    );
  }
  // Held from git's start to its answer, so a removal never deletes the `node_modules` a provision, a hook's install
  // or an unshare is writing; a lock held or unresolvable leaves the tree where it is. Inside
  // it, the machine's delete lease, so git's in-place delete never runs beside a prune's.
  const held = withDepsLock({
    act: () =>
      withDeleteLease({
        act: () => deps.git({ args: ["worktree", "remove", ...(force ? ["--force"] : []), row.path], cwd: repoRoot }),
        root: deleteLeaseRoot(),
        sleep: sleepSync,
        waitMs: GIT_LEASE_WAIT_MS,
      }),
    waitMs: 0,
    worktree: row.path,
  });
  if (held.isErr()) {
    return err(WorktreeErrors.depsLocked({ detail: held.error, path: row.path }));
  }
  if (held.value.kind === "busy") {
    return err(WorktreeErrors.deleteLeaseUnheld({ detail: "another delete held it past the wait", path: row.path }));
  }
  if (held.value.kind === "unavailable") {
    return err(WorktreeErrors.deleteLeaseUnheld({ detail: held.value.why, path: row.path }));
  }
  const removed = held.value.value;
  return removed === undefined
    ? err(
        WorktreeErrors.gitFailed({
          detail: `\`git worktree remove ${row.path}\` refused${force ? "" : " — pass --force to remove a worktree with uncommitted changes"}`,
        }),
      )
    : ok(row);
}
