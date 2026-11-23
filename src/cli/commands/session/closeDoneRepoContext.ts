/**
 * What one repository says about its own worktrees, read once per `session close-done` reclaim however many closed
 * seats it owns — the git half of `./closeDoneReclaim.ts`, apart from the seat-judging half that consumes it.
 */
import type { WorktreeInfo } from "../../../cmux/worktreeList.js";
import { worktreePathKey } from "../../../worktree/location.js";
import { listRepoWorktrees, trunkRefOf } from "../../../worktree/pruneScan.js";

/** One repository's list and trunk, read once however many seats it owns. */
export interface RepoContext {
  readonly trunk: string | null;
  readonly pathsByKey: ReadonlyMap<string, Pick<WorktreeInfo, "branch" | "locked" | "path">>;
}

/**
 * The repository's worktree list and trunk ref, read once and reused.
 *
 * @param repoRoot the declared main checkout
 * @param repos the per-run cache
 * @returns what the repository knows about its own worktrees
 */
export function repoContext({
  repoRoot,
  repos,
}: {
  readonly repoRoot: string;
  readonly repos: Map<string, RepoContext>;
}): RepoContext {
  const cached = repos.get(repoRoot);
  if (cached !== undefined) {
    return cached;
  }
  const entries = listedEntries({ repoRoot });
  // The lock travels with the entry: a seat that took `git worktree lock` is held by the scan, never only by the
  // removal's last read, which a lock released in between would no longer see.
  const pathsByKey = new Map(entries.map((entry) => [worktreePathKey({ path: entry.path }), listedEntry({ entry })]));
  const context: RepoContext = { pathsByKey, trunk: trunkRefOf({ repoRoot }) };
  repos.set(repoRoot, context);
  return context;
}

/**
 * One listed worktree narrowed to what the close-time scan reads. The lock is kept because the scan's lock hold is
 * the only one a lock released before the removal's last read would still have caught.
 *
 * @param entry what git's list printed for the seat's tree
 * @returns its path, its branch and, when git printed one, its lock
 */
export function listedEntry({
  entry,
}: {
  readonly entry: WorktreeInfo;
}): Pick<WorktreeInfo, "branch" | "locked" | "path"> {
  if (entry.locked === true) {
    return { branch: entry.branch, locked: true, path: entry.path };
  }
  return { branch: entry.branch, path: entry.path };
}

/**
 * The repository’s worktree entries, or none when git could not be asked for them.
 *
 * An unreadable list becomes an EMPTY index, and that is safe in exactly one direction: every seat then
 * misses its own entry and is kept with "git no longer lists it", which is a keep rather than a removal.
 * Spelled as a statement because `no-silent-fallback` refuses the `??` and oxlint refuses the ternary that
 * would replace it — `memory/prePushHook.ts` is the shape both gates accept.
 *
 *  repoRoot the declared main checkout
 *  the entries git listed, or none
 */
function listedEntries({ repoRoot }: { readonly repoRoot: string }): readonly WorktreeInfo[] {
  const listed = listRepoWorktrees({ repoRoot });
  if (listed === null) {
    return [];
  }
  return listed;
}
