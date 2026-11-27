/**
 * What `--apply` re-reads right before a removal, because the scan's facts are up to `--scan-budget` +
 * `--budget` old by then and `git worktree remove` does not check all of them itself.
 */
import { realpathSync } from "node:fs";

import { findWorktreeAtPath, parseWorktreeListPorcelain } from "../cmux/worktreeList.js";
import { isSnapshotCommit, snapshotWarmReason, snapshotWitnessed } from "./freshSnapshotPath.js";
import { unexpectedLapWork } from "./lapTreeProvenance.js";
import type { PruneVerdict } from "./pruneClassify.js";
import { readIgnoredWork, readTreeStashes } from "./pruneContext.js";
import {
  deletionsOnlyIn,
  filterWouldRun,
  hiddenEditsNow,
  holdsSubmodule,
  realGit,
  workingTreeStatus,
} from "./pruneGit.js";
import { LAP_GITDIR_FILES } from "./pruneLapPin.js";
import { PRUNE_REMOTE, remoteStillCarries } from "./pruneRemote.js";
import { activityNowMs, detachedHead } from "./pruneScan.js";
import { symlinkEditsNow } from "./pruneSymlinks.js";
import { privateHistoryWithinHead } from "./snapshotPrivateHistory.js";

/**
 * Why a tree may not be removed because of what git's worktree list says about it NOW, or `null` when nothing does.
 *
 * Pure over the listing a caller read, so each answer is a literal fixture. It fails CLOSED: an unreadable listing
 * keeps the tree, because a lock taken since the scan cannot then be ruled out, and so does a path git no longer
 * registers, which `git worktree remove` would refuse anyway — but only after the apply had moved its
 * `node_modules` aside. A lock is matched by path through `findWorktreeAtPath`, so the `worktrees` alias and
 * the physical `worktrees.noindex/` spelling are one tree.
 *
 * @param listing `git worktree list --porcelain` read just now, or `null` when git could not be asked
 * @param path the tree about to be removed
 * @returns the reason it is kept, or `null` when the listing names it unlocked
 */
export function lockHoldIn({ listing, path }: { listing: string | null; path: string }): string | null {
  if (listing === null) {
    return "git's worktree list could not be read just now, so a lock taken since the scan cannot be ruled out — kept";
  }
  const entry = findWorktreeAtPath({ path, worktrees: parseWorktreeListPorcelain({ text: listing }) });
  if (entry === undefined) {
    return "git no longer registers it, so the next scan judges it — kept";
  }
  if (entry.locked === true) {
    return "locked by `git worktree lock` since the scan — kept";
  }
  return null;
}

/**
 * {@link lockHoldIn} over the repository's worktree list read now — the removal's last read before anything moves.
 *
 * @param path the tree about to be removed
 * @param repoRoot the repository it belongs to
 * @returns the reason it is kept, or `null` when git lists it unlocked
 */
export function lockHoldNow({ path, repoRoot }: { path: string; repoRoot: string }): string | null {
  return lockHoldIn({ listing: realGit({ args: ["worktree", "list", "--porcelain"], cwd: repoRoot }), path });
}

/**
 * Pin a one-off Codex snapshot's HEAD for the removal's last check: only the HEAD the scan read, and only while
 * its activity read NOW is still cold.
 *
 * A snapshot is detached and on no ref the prune keeps, so a commit made onto it after the scan would go with
 * the tree. Its dates prove nothing — a commit carries any author and committer date it is given, and editing a
 * tracked file leaves the root's mtime alone — so a HEAD other than the
 * scan's is refused whatever the age reads. A commit made after THIS read moves HEAD off the pin, which
 * `headMoved` refuses last of all.
 *
 * **The witness is evidence, and a local ref is what keeps the work**, exactly as {@link pinDetached} does: the
 * branch that contained the parent can be deleted or forced between this read and the removal, so the snapshot's HEAD — and through it that parent — is kept under {@link PINNED_SNAPSHOT} first.
 *
 * @param path the snapshot's worktree
 * @param repoRoot the repository the keep ref is written into
 * @param nowMs the instant the removal is judged at
 * @param scannedHead the HEAD the scan read, carried on the verdict; absent, nothing is pinned
 * @returns the pinned sha, or why the tree is kept
 */
export function pinSnapshot({
  path,
  repoRoot,
  nowMs,
  scannedHead,
}: {
  path: string;
  repoRoot: string;
  nowMs: number;
  scannedHead: string | undefined;
}): { headSha: string } | { declined: string } {
  const headSha = realGit({ args: ["rev-parse", "HEAD"], cwd: path });
  if (headSha === null) {
    return { declined: "its HEAD could not be read before removal — kept" };
  }
  if (scannedHead === undefined || headSha !== scannedHead) {
    return { declined: "its HEAD is not the one the scan read — a commit since, however dated, kept it" };
  }
  if (!isSnapshotCommit({ git: realGit, path, rev: headSha })) {
    return { declined: "its HEAD is not the snapshot code's own commit — kept for the ordinary rules" };
  }
  if (!snapshotWitnessed({ git: realGit, path, rev: headSha })) {
    return { declined: "the commit it was frozen from is on no ref now — kept for the ordinary rules" };
  }
  // The removal deletes this tree's private gitdir, so a commit made onto it and reset away would go with it.
  if (!privateHistoryWithinHead({ git: realGit, path, rev: headSha })) {
    return { declined: "its own gitdir names a commit its HEAD does not contain, or could not be read — kept" };
  }
  const warm = snapshotWarmReason({ activityMs: activityNowMs({ path }), nowMs });
  if (warm !== null) {
    return { declined: warm };
  }
  if (realGit({ args: ["update-ref", `${PINNED_SNAPSHOT}${headSha}`, headSha], cwd: repoRoot }) === null) {
    return { declined: "its HEAD could not be kept under a local ref, so nothing was removed" };
  }
  return { headSha };
}

/** The namespace a detached tree's HEAD is kept under once its tree is gone. */
export const PINNED_DETACHED = "refs/slopweaver/pruned-detached/";

/**
 * The namespace a removed snapshot's HEAD is kept under, and with it the commit it was frozen from. Shared by every
 * worktree, so the removal cannot take it; `git for-each-ref refs/slopweaver/pruned-snapshot/` lists them.
 */
export const PINNED_SNAPSHOT = "refs/slopweaver/pruned-snapshot/";

/**
 * Keep a detached tree's HEAD under a local ref, once a live remote branch still carries it — or say why not.
 *
 * `detached` is the ONE class a ref does not backstop: `git worktree remove` refuses a dirty tree, a branch is
 * deleted only at a tip the trunk carries, and `pushed` keeps its branch ref — a detached tree has no
 * branch, so a commit on it is on no ref at all. So its witness is re-read now, not trusted from a scan up to
 * `--scan-budget` + `--budget` old, and the remote itself is asked, never its tracking ref (`remoteStillCarries`).
 *
 * The remote is evidence the work was pushed, and never the only thing keeping it: the p3 Codex pass deleted
 * the carrying branch after `ls-remote` had answered and before the removal, leaving the commit on a stale
 * tracking ref a `fetch --prune` drops. A local ref closes that window whatever the remote does next, and
 * costs one ref over objects the repository already holds. `git for-each-ref refs/slopweaver/pruned-detached/`
 * lists them; `git update-ref -d <ref>` lets one go.
 *
 * @param path the detached worktree
 * @param repoRoot the repository the ref is written into
 * @returns the pinned sha, or why the tree is kept
 */
export function pinDetached({
  path,
  repoRoot,
}: {
  path: string;
  repoRoot: string;
}): { headSha: string } | { declined: string } {
  const headSha = detachedHead({ path, repoRoot }).headSha;
  if (headSha === null || !remoteStillCarries({ git: realGit, headSha, repoRoot })) {
    return {
      declined:
        "no live remote branch carries its HEAD — it moved after the scan read it, or the branch is gone " +
        "from the remote, so nothing was removed and the next run classifies it afresh",
    };
  }
  if (realGit({ args: ["update-ref", `${PINNED_DETACHED}${headSha}`, headSha], cwd: repoRoot }) === null) {
    return { declined: "its HEAD could not be kept under a local ref, so nothing was removed" };
  }
  return { headSha };
}

/**
 * Why a tree must be kept for a change since the scan that `git worktree remove` itself would not notice.
 *
 * @param verdict the classified worktree about to be removed
 * @param pinnedHead the sha {@link pinDetached} kept, for a detached tree; its HEAD must still be it
 * @param salvagedTo the branch a salvage switched the tree onto; it must still be checked out
 * @returns the reason it is kept, or null when removal may go ahead
 */
export function changedSinceScan({
  verdict,
  pinnedHead,
  salvagedTo = null,
}: {
  verdict: PruneVerdict;
  pinnedHead?: string | undefined;
  salvagedTo?: string | null;
}): string | null {
  const interrupted = verdict.cls === "interrupted";
  // Every read below asks git about the tree, so git must be reading THIS directory, not one config names.
  if (!readsItself({ path: verdict.path })) {
    return "git reads another directory as this tree's working tree, or could not say which — kept";
  }
  // Next, because every git read after it — this re-read's `status`, and the removal's own — would run it.
  if (filterWouldRun({ git: realGit, path: verdict.path }) !== false) {
    return "a filter command is configured over a file here, and git would run it before the removal — kept";
  }
  const status = workingTreeStatus({ git: realGit, path: verdict.path });
  // `--force` deletes untracked and modified work, so the deletion-only shape that earned it is read AGAIN:
  // a file written into the tree since the scan appears in no live register.
  if (interrupted && !deletionsOnlyIn({ text: status })) {
    return "no longer only deletions, or its status could not be read, since the scan — kept";
  }
  // Every other class goes without `--force`, and git's own dirty check reads the repository's status config:
  // under `status.showUntrackedFiles=no` it removed a file written since the scan (the p3 and r3 Codex passes).
  if (!interrupted && status !== "") {
    return "it carries a change, or its status could not be read, since the scan — kept";
  }
  // `git worktree remove` deletes ignored files unasked, and no git command ever looks at a stash on removal.
  // A `lap` tree's own report directories are the one exception, and only for that class.
  const ignored = ownIgnoredWork({ verdict });
  if (ignored === null || ignored.length > 0) {
    return "it carries ignored files no build writes again, or they could not be listed, since the scan — kept";
  }
  const stashes = readTreeStashes({ branch: verdict.branch, git: realGit, path: verdict.path });
  if (stashes !== 0) {
    return "a stash was made from it, or its stashes could not be listed, since the scan — kept";
  }
  // `git worktree remove` does not look at a file hidden from `status`, nor at one whose stat data the cache
  // vouches for, so every regular tracked file's bytes are read here, AFTER the status read above. In an
  // `interrupted` tree a file already deleted is the failed removal's own work; one still there is read.
  // A symlink's target is read the same way: `status` vouches for it by stat data alone.
  if (
    hiddenEditsNow({ every: true, gutted: interrupted, path: verdict.path }) !== 0 ||
    symlinkEditsNow({ gutted: interrupted, path: verdict.path }) !== 0
  ) {
    return "a tracked file carries an edit status cannot see, or could not be read, since the scan — kept";
  }
  // A submodule checkout is a repository of its own inside the tree, and `--force` takes it whole.
  if (interrupted && holdsSubmodule({ git: realGit, path: verdict.path }) !== false) {
    return "it carries a submodule, or git could not say, and --force would delete that checkout — kept";
  }
  return lastReads({ pinnedHead, salvagedTo, verdict });
}

/**
 * The reads `changedSinceScan` makes last, closest to the removal: what the tree's own gitdir and HEAD say now.
 *
 * @param verdict the classified worktree about to be removed
 * @param pinnedHead the sha the pin kept; a snapshot's gitdir and every pinned HEAD answer to it
 * @param salvagedTo the branch a salvage switched the tree onto
 * @returns the reason it is kept, or null when removal may go ahead
 */
function lastReads({
  verdict,
  pinnedHead,
  salvagedTo,
}: {
  verdict: PruneVerdict;
  pinnedHead: string | undefined;
  salvagedTo: string | null;
}): string | null {
  // A snapshot's or a lap tree's private gitdir goes with it, so a ref written into it since the pin —
  // `refs/bisect/keep` on a commit whose only branch then went — is read again here, as close to the removal as
  // the HEAD read. A lap tree's gitdir also carries its marker, which is read for ids like every other file.
  const alsoAllowed = verdict.cls === "lap" ? LAP_GITDIR_FILES : [];
  if (
    (verdict.cls === "snapshot" || verdict.cls === "lap") &&
    (pinnedHead === undefined ||
      !privateHistoryWithinHead({ alsoAllowed, git: realGit, path: verdict.path, rev: pinnedHead }))
  ) {
    return "its own gitdir names a commit its HEAD does not contain, or could not be read, since the pin — kept";
  }
  // Last, so a commit made while the reads above ran is not left on no ref at all.
  const moved = headMoved({ pinnedHead, salvagedTo, verdict });
  if (moved !== null) {
    return moved;
  }
  return unpushedSinceScan({ verdict });
}

/**
 * Whether the branch a removal keeps now carries a commit `origin` does not have, which holds the tree (the owner's
 * rule). Only {@link PRUNE_REMOTE} counts: a remote of another history is no backup (`./pruneRemote.ts`).
 *
 * A branch the removal deletes is not asked: it is deleted only when the trunk carries its tip, and
 * the scan already counted an absorbed branch's pre-squash commits as backed. A detached tree answers to its pin.
 * A salvaged tree answers to its push, whose read-back asked the remote itself: it pushes to a literal url, which
 * moves no remote-tracking ref, so `--not --remotes` would count the capture's own commits as on no remote.
 *
 * @param verdict the classified worktree about to be removed
 * @returns the reason it is kept, or null when every commit on the kept branch is on a remote
 */
function unpushedSinceScan({ verdict }: { verdict: PruneVerdict }): string | null {
  const branch = verdict.branch;
  if (verdict.deleteBranch || !ON_ITS_BRANCH.has(verdict.cls) || branch === null) {
    return null;
  }
  const unpushed = realGit({
    args: ["rev-list", "--count", branch, "--not", `--remotes=${PRUNE_REMOTE}`],
    cwd: verdict.path,
  });
  if (unpushed !== "0") {
    return "it carries a commit origin does not, or its commits could not be counted, since the scan — kept";
  }
  return null;
}

/**
 * The ignored entries that hold a tree at removal: every one, bar a `lap` tree's own report directories.
 *
 * @param verdict the classified worktree about to be removed
 * @returns those entries, or `null` when they could not be listed
 */
function ownIgnoredWork({ verdict }: { verdict: PruneVerdict }): readonly string[] | null {
  const ignored = readIgnoredWork({ git: realGit, path: verdict.path });
  if (ignored === null || verdict.cls !== "lap") {
    return ignored;
  }
  return unexpectedLapWork({ ignoredWork: ignored });
}

/**
 * Whether git, run in a tree, takes that same directory as its working tree.
 *
 * A per-worktree `core.worktree` points every read at another directory, while `git worktree remove` deletes the
 * registered one: the r3 Codex review aimed it at an empty decoy, status read ` D tracked` there, and `--force`
 * deleted an untracked only copy in the real tree.
 *
 * @param path the worktree about to be removed
 * @returns true only when `rev-parse --show-toplevel` resolves to the same real directory
 */
function readsItself({ path }: { path: string }): boolean {
  const top = realGit({ args: ["rev-parse", "--show-toplevel"], cwd: path });
  try {
    return top !== null && realpathSync(top) === realpathSync(path);
  } catch {
    return false;
  }
}

/** The classes whose verdict names the branch the tree has checked out, which must keep every commit on it. */
const ON_ITS_BRANCH: ReadonlySet<PruneVerdict["cls"]> = new Set(["interrupted", "merged", "pushed"]);

/**
 * The local branch that must still be checked out for a tree's commits to outlive its removal.
 *
 * @param verdict the classified worktree about to be removed
 * @param salvagedTo the branch a salvage switched the tree onto, which is the one keeping its work
 * @returns that branch, `""` for a salvaged tree with no salvage branch to vouch for it, or null for a class
 *   that answers to a pinned sha or to nothing
 */
function keepingBranch({ salvagedTo, verdict }: { salvagedTo: string | null; verdict: PruneVerdict }): string | null {
  if (verdict.cls === "salvaged") {
    if (salvagedTo === null) {
      return "";
    }
    return salvagedTo;
  }
  if (ON_ITS_BRANCH.has(verdict.cls)) {
    return verdict.branch;
  }
  return null;
}

/**
 * Whether a tree's HEAD has left what keeps its commits: the sha pinned for a detached tree, or the branch
 * its verdict names, or the salvage branch a capture switched it onto.
 *
 * A commit made ON the branch stays on a ref — `pushed`, `interrupted` and `salvaged` keep the
 * branch, and a `merged` one that has moved is kept, its new tip not in the trunk. A commit made after switching OFF it is
 * on no ref at all: the r3 Codex review detached an interrupted tree, committed a new file, deleted another,
 * and `--force` removed the only checkout of a commit nothing named; then did the same to a salvaged tree
 * between its capture and its removal.
 *
 * @param verdict the classified worktree about to be removed
 * @param pinnedHead the sha kept under a local ref, or `undefined` for a tree that pinned nothing
 * @param salvagedTo the branch a salvage switched the tree onto
 * @returns the reason it is kept, or null when HEAD is still what keeps its work
 */
function headMoved({
  pinnedHead,
  salvagedTo,
  verdict,
}: {
  pinnedHead: string | undefined;
  salvagedTo: string | null;
  verdict: PruneVerdict;
}): string | null {
  if (pinnedHead !== undefined && realGit({ args: ["rev-parse", "HEAD"], cwd: verdict.path }) !== pinnedHead) {
    return "its HEAD moved off the commit kept for it, or could not be read, since the pin — kept";
  }
  const branch = keepingBranch({ salvagedTo, verdict });
  if (branch === null) {
    return null;
  }
  if (
    branch === "" ||
    realGit({ args: ["symbolic-ref", "-q", "HEAD"], cwd: verdict.path }) !== `refs/heads/${branch}`
  ) {
    return "its HEAD is no longer on the branch that keeps its commits, or could not be read — kept";
  }
  return null;
}
