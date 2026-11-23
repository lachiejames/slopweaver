/**
 * Reading `git worktree list --porcelain` text a caller already read.
 *
 * Two readings, because git's list holds two kinds of worktree. {@link parseWorktreeListPorcelain} is faithful
 * to what git printed, and pure. {@link parseOperationalWorktrees} drops the Codex snapshot-pool slots
 * (`../worktree/snapshotPoolPath.ts`): they stay registered between passes and are infrastructure, not
 * anybody's work, so a planner, an inventory row, a registration count or `worktree prune` that saw one would
 * be reading the wrong thing — and prune would eventually salvage a tree a pass may be reading. It reads the
 * disk only for a detached worktree already shaped like a slot, to confirm the pool's own files are there. A
 * detached worktree beside a hand-made copy of every one of those files is hidden too: the pool would lease and
 * reset it as a slot, so it is one.
 *
 * The operational reading also fills {@link WorktreeInfo.heldBranches} for a detached worktree a rebase or bisect
 * still holds a branch in (`./worktreeHeldBranch.ts` has the measurement), reading the git directory the
 * repository's own records keep for that tree.
 *
 * {@link findWorktreeForBranch} and {@link findWorktreeAtPath} look one worktree up in what was read, and are pure.
 */
import { worktreePathKey } from "../worktree/location.js";
import { isSnapshotPoolSlot } from "../worktree/snapshotPoolPath.js";
import { type ListingRepository, readHeldBranches } from "./worktreeHeldBranch.js";

/** One entry from `git worktree list`. */
export interface WorktreeInfo {
  /** Absolute path of the worktree. */
  readonly path: string;
  /** The branch checked out there, or `null` for a detached HEAD — exactly what porcelain printed. */
  readonly branch: string | null;
  /**
   * The branches git still HOLDS for a detached worktree because a rebase or bisect there detached its HEAD —
   * `git worktree add` refuses each elsewhere ("is already used by worktree") — the rebase's first. A list, because
   * a rebase of another branch started mid-bisect holds two. Absent by design whenever nothing holds one, which is
   * every reading but the operational one of a held detached tree: an optional key rather than a required empty
   * list so a fixture or a raw parse need not spell a hold it cannot have. Never set alongside {@link branch}; ask
   * {@link ownedBranches} for what a tree owns either way.
   */
  readonly heldBranches?: readonly string[];
  /**
   * Present, and true, when git printed a `locked` line for this worktree (`git worktree lock`, with or without a
   * reason). Absent rather than `false` when it did not, so a fixture or an inventory row that never came from
   * porcelain need not spell a lock it cannot have; a safety decision reads it as `locked === true`.
   */
  readonly locked?: true;
}

/**
 * Parse `git worktree list --porcelain` output into one entry per worktree.
 *
 * Pure: takes the raw text a caller already read, so it is testable against a literal fixture with no
 * filesystem or subprocess involved.
 *
 * @param text the porcelain output
 * @returns one {@link WorktreeInfo} per block, in the order git printed them
 */
export function parseWorktreeListPorcelain({ text }: { text: string }): readonly WorktreeInfo[] {
  return porcelainRecords({ text }).map((record) =>
    withLock({ info: { branch: record.branch, path: record.path }, record }),
  );
}

/** One porcelain block: its path and branch, plus whether git printed its `detached` and `locked` lines. */
type PorcelainRecord = Omit<WorktreeInfo, "heldBranches" | "locked"> & {
  readonly detached: boolean;
  readonly locked: boolean;
};

/** An entry carrying {@link WorktreeInfo.locked} only when git printed the lock, so an unlocked one is unchanged. */
function withLock({ info, record }: { info: WorktreeInfo; record: PorcelainRecord }): WorktreeInfo {
  if (!record.locked) {
    return info;
  }
  return { ...info, locked: true };
}

/** Every porcelain block with a path, plus whether git printed its `detached` line. */
function porcelainRecords({ text }: { text: string }): readonly PorcelainRecord[] {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const pathLine = lines.find((line) => line.startsWith("worktree "));
      const branchLine = lines.find((line) => line.startsWith("branch refs/heads/"));
      // Never trimmed: a path may end in a space, and `slot-0/tree ` trimmed is a pool slot's name.
      const path = pathLine === undefined ? undefined : pathLine.slice("worktree ".length);
      return {
        branch: branchLine === undefined ? null : branchLine.slice("branch refs/heads/".length).trim(),
        detached: lines.includes("detached"),
        // `locked`, or `locked <reason>`: only whether a lock exists is ever asked, never its reason.
        locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
        path,
      };
    })
    .filter((entry): entry is PorcelainRecord => entry.path !== undefined);
}

/**
 * The OPERATIONAL worktrees in `git worktree list --porcelain` output: every one except a snapshot-pool slot.
 *
 * @param text the porcelain output
 * @param repository the repository the listing was read in, through whose records a detached tree's holds are
 * read — `null` when its common directory could not be asked, and then no hold is read
 * @returns one {@link WorktreeInfo} per operational worktree, in the order git printed them, main checkout first
 */
export function parseOperationalWorktrees({
  repository,
  text,
}: {
  repository: ListingRepository | null;
  text: string;
}): readonly WorktreeInfo[] {
  // A slot is always detached, so a worktree on a branch, or a bare one, is somebody's work wherever it sits
  // — only git's own `detached` line qualifies, never a missing branch line. A detached slot stays hidden
  // even while a bisect there holds a branch: a slot is never a seat, so a spawn on that branch
  // fails loudly in `git worktree add` rather than seating in a pass's tree; prune's DELETION reads every admin
  // directory instead (`heldBranchesAnywhere`), so the hidden slot cannot cost the branch.
  return porcelainRecords({ text })
    .filter((record) => !record.detached || !isSnapshotPoolSlot({ path: record.path }))
    .map((record) => withHeldBranches({ record, repository }));
}

/** One operational record, carrying {@link WorktreeInfo.heldBranches} only for a detached tree a rebase or bisect holds. */
function withHeldBranches({
  record,
  repository,
}: {
  record: PorcelainRecord;
  repository: ListingRepository | null;
}): WorktreeInfo {
  const { branch, detached, path } = record;
  if (!detached || repository === null) {
    return withLock({ info: { branch, path }, record });
  }
  const heldBranches = readHeldBranches({ repository, worktreePath: path });
  if (heldBranches.length === 0) {
    return withLock({ info: { branch, path }, record });
  }
  return withLock({ info: { branch, heldBranches, path }, record });
}

/**
 * Every branch a worktree OWNS: the one checked out there, or each a rebase or bisect there still holds. What a
 * reuse or occupancy decision asks; a prune or inventory fact reads {@link WorktreeInfo.branch} instead, because a
 * held tree is still detached.
 *
 * @param worktree the worktree to ask about
 * @returns the owned branches — empty for a detached tree no operation holds a branch in
 */
export function ownedBranches({ worktree }: { worktree: WorktreeInfo }): readonly string[] {
  if (worktree.branch !== null) {
    return [worktree.branch];
  }
  if (worktree.heldBranches === undefined) {
    return [];
  }
  return worktree.heldBranches;
}

/**
 * The branch a reused worktree REPORTS: the one checked out there, else the first a rebase or bisect holds, the
 * rebase's — the one `git status` there names.
 *
 * @param worktree the worktree to ask about
 * @returns the reported branch, or `null` for a detached tree no operation holds a branch in
 */
export function worktreeBranch({ worktree }: { worktree: WorktreeInfo }): string | null {
  const owned = ownedBranches({ worktree })[0];
  if (owned === undefined) {
    return null;
  }
  return owned;
}

/**
 * The branch a spawn or provision reports: the first of the caller's candidates the reused tree owns, else that
 * tree's own ({@link worktreeBranch}, so one mid-rebase or mid-bisect reports the branch it holds although it is
 * detached), else the branch it would create. Candidates first, because a rebase of another branch started
 * mid-bisect holds two, and the row asked for the bisect's.
 *
 * @param candidates branch names in priority order, the ones the reuse lookup searched for
 * @param existing the worktree being reused, `undefined` when a new one is created
 * @param whenAbsent the branch reported when no reused tree names one
 * @returns the branch to report
 */
export function reusedTreeBranch({
  candidates,
  existing,
  whenAbsent,
}: {
  candidates: readonly string[];
  existing: WorktreeInfo | undefined;
  whenAbsent: string;
}): string {
  if (existing === undefined) {
    return whenAbsent;
  }
  const owns = ownedBranches({ worktree: existing });
  const asked = candidates.find((candidate) => owns.includes(candidate));
  if (asked !== undefined) {
    return asked;
  }
  const owned = worktreeBranch({ worktree: existing });
  if (owned === null) {
    return whenAbsent;
  }
  return owned;
}

/**
 * The worktree already holding one of a set of candidate branches, if any — checked out there, or held there by a
 * rebase or bisect ({@link ownedBranches}).
 *
 * @param worktrees the repository's current worktrees
 * @param candidates branch names in priority order (an exact match on the FIRST one found wins the search,
 *   not the list's own order — every candidate is checked, the earliest-listed worktree wins ties)
 * @returns the matching worktree, or `undefined` when none of the candidates has one
 */
export function findWorktreeForBranch({
  worktrees,
  candidates,
}: {
  worktrees: readonly WorktreeInfo[];
  candidates: readonly string[];
}): WorktreeInfo | undefined {
  const wanted = new Set(candidates);
  return worktrees.find((worktree) => ownedBranches({ worktree }).some((owned) => wanted.has(owned)));
}

/**
 * The registered worktree already AT a path, if any — whatever branch it holds.
 *
 * The second reuse key (see `./worktree.ts`'s header): a spawn that would create its worktree at `path` must
 * open the one already registered there instead, because that directory is exactly the prior round's work
 * a closed session deliberately kept. Compared through {@link worktreePathKey}, because git registers the
 * PHYSICAL path (`worktrees.noindex/`) while a planner or a session may spell the same directory through the
 * `worktrees` alias — `worktree/location.ts` has the measurement.
 *
 * @param worktrees the repository's current worktrees
 * @param path the directory a spawn would otherwise create
 * @returns the worktree registered at that path, or `undefined` when git lists none there
 */
export function findWorktreeAtPath({
  worktrees,
  path,
}: {
  worktrees: readonly WorktreeInfo[];
  path: string;
}): WorktreeInfo | undefined {
  const wanted = worktreePathKey({ path });
  return worktrees.find((worktree) => worktreePathKey({ path: worktree.path }) === wanted);
}
