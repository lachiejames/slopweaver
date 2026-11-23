/**
 * Acting on a plan — the only file in `worktree prune` that deletes anything.
 *
 * ## Git's refusals are kept as refusals, with exactly one stated exception
 *
 * `git worktree remove` refuses a tree with modified or untracked files, and that is kept as a REFUSAL rather
 * than overridden, because it is a second, independent opinion about the safety this verb already decided for
 * itself — and a verb whose whole justification is "it never deletes work" cannot be the one that overrides
 * the tool telling it to stop.
 *
 * A branch ref goes only when its tip is an ANCESTOR of the trunk, asked directly rather than through
 * `git branch -d`, whose "merged" a repository can point at the branch itself ({@link deleteBranchInTrunk}).
 * That has a visible consequence and it is the correct one: a squash-merged branch is absorbed by patch id
 * but is not an ancestor, so its ref is kept. The tree — which is where every one of the reclaimed gigabytes
 * lives — goes anyway, and the branch ref, which costs forty bytes, stays. The result line says so per
 * worktree rather than reporting a clean sweep it did not make.
 *
 * **The exception is the `interrupted` class, and it is not a hole in that rule.** When a removal dies
 * part-way — a scheduler tick killed at its time bound, a laptop closing — git has already deleted the
 * tracked files and the worktree stays registered, dirty with nothing but deletions. Git will now refuse it
 * forever, so a verb that only ever respects that refusal LEAKS one gutted checkout per interruption, and a
 * daily scheduled run is exactly the thing that gets interrupted. Here git's refusal is not an independent
 * opinion at all: it is an artifact of this verb's own half-finished write. `--force` is used only for that
 * class, whose membership the classifier keeps narrow — every entry a deletion, work provably absorbed into
 * the trunk or carried whole by the branch's own remote branch (whose ref is then KEPT), unreferenced, and
 * cold. Measured: five such trees in one night's backlog run.
 *
 * ## Every removal is judged from what it left
 *
 * Git's exit code is not the verdict. `./pruneRemoved` reads the directory afterwards: a path that is gone is
 * removed, a refusal that deleted nothing is a decline, and anything else is FAILED, which `worktree prune`
 * exits non-zero on. Its header carries why a refusal can still leave a half-removed, unregistered tree.
 *
 * ## The `salvaged` class is the one where the copy IS the argument
 *
 * The owner's week-old waiver releases the holds over a tree carrying work that exists nowhere else, on the condition
 * that the work is pushed to a remote branch first. There is no branch ref to lean on and no second opinion
 * to fall back to, and the remote branch {@link SalvageSeam} creates is the entire reason the removal is safe.
 *
 * Three consequences are the design rather than notes on it. **The branch is always a fresh one, and fresh
 * is PROVEN rather than assumed** — never the branch the tree was checked out on, because that is frequently
 * an open pull request's head, and never a `salvage/…` name the remote already carries, because a push to an
 * existing ref fast-forwards it and the read-back reports success either way. `./pruneSalvage`'s
 * `freeSalvageName` probes both sides and keeps the tree when it cannot get an answer.
 * **The push is verified by reading the ref back**,
 * never by an exit code — `./pruneSalvage` goes through `github push`'s own `pushAndVerify`, whose
 * contract is the remote reporting exactly the commit that was sent. And **the seam is optional, so a caller
 * that has not wired a capture cannot remove one of these trees at all**: {@link applyVerdict} declines the
 * class outright rather than defaulting to a push, because a default would hand the destructive half to
 * anyone who forgot the other one.
 *
 * This is also the one class that defeats a git refusal in the ordinary case rather than the exceptional
 * one. `git worktree remove` would decline every dirty tree here — and it does not get the chance, because
 * the salvage commits the changes before the removal is attempted. What replaces that refusal is the
 * remote's own confirmation, and nothing else does.
 *
 * ## The `detached` class re-reads its own witness, because git will not
 *
 * Every other class this file acts on is backstopped by a git refusal that is evaluated NOW rather than at
 * scan time: `git worktree remove` declines a tree that has become dirty, a branch is deleted only at a tip
 * the trunk carries, and `pushed` keeps its branch ref whatever was committed onto it
 * since. A detached tree has no branch to keep, so a commit made onto it after the scan read it would be on
 * no ref at all and the removal would end the only copy. The scan can be `--scan-budget` + `--budget` old by
 * the time a removal runs, which on the measured backlog is up to twenty-five minutes. {@link applyVerdict}
 * therefore re-reads HEAD and asks the remote itself, with `ls-remote`, whether a live branch still contains
 * it — a remote-tracking ref outlives a branch GitHub deleted on merge — and declines when none does.
 */
import { execFileSync } from "node:child_process";

import { absentAs } from "#lib/absent.js";
import { deleteBranchInTrunk } from "./pruneBranchDelete.js";
import type { PruneVerdict } from "./pruneClassify.js";
import { changedSinceScan, lockHoldNow, pinDetached, pinSnapshot } from "./pruneRecheck.js";
import { REMOVE_MAX_BUFFER, REMOVE_TIMEOUT_MS, refusalOf } from "./pruneRefusal.js";
import { finishResidue, judgeRemoval, readAfterRemoval } from "./pruneRemoved.js";
import { removeWithBulkAside } from "./reclaimTrash.js";

/** What happened to one worktree when a plan was applied. */
export interface PruneOutcome {
  readonly path: string;
  readonly branch: string | null;
  /** Whether the working tree is gone from disk. */
  readonly treeRemoved: boolean;
  /**
   * Whether the removal started and could not finish, leaving something at the path. `declined` says what.
   * Never true alongside {@link PruneOutcome.treeRemoved}, and never folded into a decline.
   */
  readonly failed: boolean;
  /** Whether the branch ref was also deleted — false whenever git declined, which is not a failure. */
  readonly branchDeleted: boolean;
  /** KiB freed: the measured footprint when the tree went, zero when it did not. */
  readonly freedKib: number;
  /** Git's own words when it declined something, or what a failed removal left; `null` when neither. */
  readonly declined: string | null;
  /** The remote branch a `salvaged` tree's work was pushed to, or `null` when no capture was part of it. */
  readonly salvagedTo: string | null;
}

/**
 * Capture a `salvaged` tree's work, returning the branch it now lives on or why it could not be taken.
 *
 * A SEAM rather than a direct call, and OPTIONAL rather than required, so that the fail-safe is structural:
 * a caller that has not wired the capture cannot remove a `salvaged` tree at all — see {@link applyVerdict},
 * which declines when this is absent. The alternative, a default that pushes, would mean any future caller
 * got the destructive half by forgetting something.
 */
export type SalvageSeam = (input: { verdict: PruneVerdict }) => { branch: string | null; declined: string | null };

/**
 * Apply one verdict: capture first where the class calls for it, remove the tree, then delete the branch where
 * the verdict says to and the trunk carries its tip.
 *
 * @param verdict the classified worktree to act on
 * @param repoRoot the repository holding it
 * @param salvage how a `salvaged` tree's work reaches a remote; absent, that class is declined untouched
 * @param bulkTrash the reclaim trash a tree's ignored `node_modules` is renamed into before git removes the
 *   rest (`./reclaimTrash.ts`), which both `worktree prune` and `session close-done` pass and then empty at
 *   background priority; absent, git deletes it in place at full speed
 * @param recyclePool the repository's recycle pool (`./recyclePool.ts`), which a removed tree's root `node_modules` is
 *   offered to before its trash batch commits; absent, nothing is recycled
 * @param lockHeld whether the caller still holds the lock its removals run under, read once more after any
 *   salvage push and right before git removes the tree; absent for a caller that holds none
 * @returns what actually happened, including anything git declined
 */
export function applyVerdict({
  verdict,
  repoRoot,
  salvage,
  bulkTrash,
  recyclePool,
  lockHeld,
}: {
  verdict: PruneVerdict;
  repoRoot: string;
  salvage?: SalvageSeam | undefined;
  bulkTrash?: string | undefined;
  recyclePool?: string | undefined;
  lockHeld?: (() => boolean) | undefined;
}): PruneOutcome {
  const remove = { bulkTrash, lockHeld, recyclePool, repoRoot, salvagedTo: null, verdict };
  if (verdict.cls === "detached") {
    const pin = pinDetached({ path: verdict.path, repoRoot });
    if ("declined" in pin) {
      return { ...keptOutcome({ verdict }), declined: pin.declined };
    }
    return removeTree({ ...remove, pinnedHead: pin.headSha });
  }
  if (verdict.cls === "snapshot") {
    const pin = pinSnapshot({ nowMs: Date.now(), path: verdict.path, repoRoot, scannedHead: verdict.scannedHead });
    if ("declined" in pin) {
      return { ...keptOutcome({ verdict }), declined: pin.declined };
    }
    return removeTree({ ...remove, pinnedHead: pin.headSha });
  }
  if (verdict.cls === "salvaged") {
    return applySalvaged({ bulkTrash, lockHeld, recyclePool, repoRoot, salvage, verdict });
  }
  return removeTree(remove);
}

/**
 * The outcome of a tree left exactly as it was, before the reason is added.
 *
 * @param verdict the worktree that was kept
 * @returns every field but `declined`
 */
function keptOutcome({ verdict }: { verdict: PruneVerdict }): Omit<PruneOutcome, "declined"> {
  return {
    branch: verdict.branch,
    branchDeleted: false,
    failed: false,
    freedKib: 0,
    path: verdict.path,
    salvagedTo: null,
    treeRemoved: false,
  };
}

/**
 * Apply the `salvaged` class: capture the work first, and remove the tree only once a remote confirms it.
 *
 * The reason this class exists, and the reason it is the only one shaped this way. The owner's week-old waiver
 * releases the holds over a tree carrying the only copy of some work, on the condition that the work is
 * pushed FIRST — so unlike every other class here, the remote copy is the argument rather than a second
 * opinion. Both declines leave the tree exactly as it was, and the next run reclassifies it and tries again.
 *
 * An absent seam is a DECLINE rather than a default, because a default would hand the destructive half of
 * this class to any caller who forgot to wire the other one.
 *
 * @param verdict the `salvaged` worktree to act on
 * @param repoRoot the repository holding it
 * @param salvage how the work reaches a remote, absent when the caller wired none
 * @param bulkTrash where the tree's ignored bulk is moved before removal, absent for an in-place removal
 * @param recyclePool where a removed tree's root `node_modules` is offered, absent to recycle nothing
 * @param lockHeld whether the caller still holds its removal lock, absent for a caller that holds none
 * @returns the outcome, with `salvagedTo` naming the branch when the capture landed
 */
function applySalvaged({
  bulkTrash,
  lockHeld,
  recyclePool,
  repoRoot,
  salvage,
  verdict,
}: {
  bulkTrash: string | undefined;
  lockHeld: (() => boolean) | undefined;
  recyclePool: string | undefined;
  repoRoot: string;
  salvage: SalvageSeam | undefined;
  verdict: PruneVerdict;
}): PruneOutcome {
  const kept = keptOutcome({ verdict });
  if (salvage === undefined) {
    return {
      ...kept,
      declined:
        "it needs its work pushed to a remote before it can be removed, and this caller wired no way to " +
        "do that — nothing was removed",
    };
  }
  const captured = salvage({ verdict });
  if (captured.branch === null) {
    return {
      ...kept,
      declined: `its work could not be put on a remote, so nothing was removed — ${String(captured.declined)}`,
    };
  }
  return removeTree({ bulkTrash, lockHeld, recyclePool, repoRoot, salvagedTo: captured.branch, verdict });
}

/**
 * Why a tree must be kept at the last moment before its removal, or `null` when nothing stops it: the reads that run
 * after any salvage push, closest to the one git call that cannot be fenced.
 *
 * @param verdict the classified worktree about to be removed
 * @param repoRoot the repository holding it, whose worktree list names any lock
 * @param salvagedTo the remote branch a capture pushed the work to, which must still be checked out
 * @param pinnedHead the sha a detached tree's HEAD was kept under, which it must still be at removal
 * @param lockHeld whether the caller still holds its removal lock
 * @returns the reason it is kept, or `null` when removal may go ahead
 */
function whyKeptAtRemoval({
  verdict,
  repoRoot,
  salvagedTo,
  pinnedHead,
  lockHeld,
}: {
  verdict: PruneVerdict;
  repoRoot: string;
  salvagedTo: string | null;
  pinnedHead: string | undefined;
  lockHeld: (() => boolean) | undefined;
}): string | null {
  const changed = changedSinceScan({ pinnedHead, salvagedTo, verdict });
  if (changed !== null) {
    return changed;
  }
  // A salvage push can take minutes, and a run stopped in one can resume after another took its lock over, so the
  // lock is read once more here. What remains is the one call after this, which git cannot fence.
  if (lockHeld !== undefined && !lockHeld()) {
    return "another run took this run's apply lock over — kept for that run";
  }
  // Read here, after any salvage push and before `node_modules` is renamed aside: git refuses a locked tree itself,
  // but only once that rename has already happened, and restoring it can fail.
  return lockHoldNow({ path: verdict.path, repoRoot });
}

/**
 * Remove one classified tree, then delete its branch where the verdict says to and the trunk carries its tip.
 *
 * @param verdict the classified worktree to act on
 * @param repoRoot the repository holding it
 * @param salvagedTo the remote branch a capture pushed the work to, so a successful removal can say so
 * @param pinnedHead the sha a detached tree's HEAD was kept under, which it must still be at removal
 * @param bulkTrash where the tree's ignored `node_modules` is renamed before git removes the rest, absent for an
 *   in-place removal
 * @param recyclePool where a removed tree's root `node_modules` is offered, absent to recycle nothing
 * @param lockHeld whether the caller still holds its removal lock, read last before git removes the tree
 * @returns what actually happened, including anything git declined
 */
function removeTree({
  verdict,
  repoRoot,
  salvagedTo,
  pinnedHead,
  bulkTrash,
  recyclePool,
  lockHeld,
}: {
  verdict: PruneVerdict;
  repoRoot: string;
  salvagedTo: string | null;
  pinnedHead?: string;
  bulkTrash: string | undefined;
  recyclePool: string | undefined;
  lockHeld: (() => boolean) | undefined;
}): PruneOutcome {
  // NOT measured here. A `du` over a checkout with a real `node_modules` costs about as long as deleting it,
  // so measuring every tree halved the removal rate on a backlog run — and the number it bought was
  // the weaker one anyway: `du` counts allocated blocks per tree, while what the owner asked for is how much
  // free space came back, which {@link freeKib} reads from the filesystem itself once per run.
  const measuredKib = verdict.diskKib;
  // See this module's header for why `interrupted` — and only `interrupted` — is allowed to force.
  const force = verdict.cls === "interrupted" ? ["--force"] : [];
  const kept = { ...keptOutcome({ verdict }), salvagedTo };
  const keptFor = whyKeptAtRemoval({ lockHeld, pinnedHead, repoRoot, salvagedTo, verdict });
  if (keptFor !== null) {
    return { ...kept, declined: keptFor };
  }
  const refusal = removeWithBulkAside({
    bulkTrash,
    recyclePool,
    remove: () => refusalOf({ args: ["worktree", "remove", ...force, verdict.path], cwd: repoRoot }),
    worktree: verdict.path,
  });
  const left = whatWasLeft({ path: verdict.path, refusal, repoRoot });
  if (left !== null) {
    return { ...kept, ...left };
  }
  // An `if` rather than a ternary or a `??`: a tree whose disk could not be measured freed an unknown
  // amount, and reporting zero is the honest FLOOR the caller already labels as one. Saying that out loud is
  // what `no-silent-fallback` asks for, and it is why this is not written as `measuredKib ?? 0`.
  let freedKib = 0;
  if (measuredKib !== null) {
    freedKib = measuredKib;
  }
  const removed = { ...kept, freedKib, treeRemoved: true };
  if (!verdict.deleteBranch || verdict.branch === null) {
    return { ...removed, declined: null };
  }
  const branch = deleteBranchInTrunk({ branch: verdict.branch, repoRoot });
  return { ...removed, branchDeleted: branch.deleted, declined: branch.declined };
}

/**
 * Why a removal left something at the tree's path, or `null` when nothing is there any more.
 *
 * An unregistered residue is finished when all of it is build output, because nothing after this ever sees it;
 * a registered one is left for the next scan, which still lists it.
 *
 * @param path the tree git was asked to remove
 * @param refusal git's refusal, or `null` when it exited 0
 * @param repoRoot the repository it belonged to
 * @returns a decline or a failure with what was left, or `null` once the path is empty
 */
function whatWasLeft({
  path,
  refusal,
  repoRoot,
}: {
  path: string;
  refusal: string | null;
  repoRoot: string;
}): Pick<PruneOutcome, "declined" | "failed"> | null {
  const after = readAfterRemoval({ path, repoRoot });
  const judged = judgeRemoval({ after, refusal });
  if (judged.kind === "removed") {
    return null;
  }
  if (judged.kind === "declined") {
    return { declined: judged.why, failed: false };
  }
  if (after.registered !== false) {
    return { declined: judged.why, failed: true };
  }
  const unfinished = finishResidue({ path });
  if (unfinished === null) {
    return null;
  }
  return { declined: `${judged.why}; ${unfinished}`, failed: true };
}

/**
 * Free space on the filesystem holding a path, in KiB.
 *
 * This is the honest headline for an apply: it accounts for what the deletions ACTUALLY returned to the
 * volume, including whatever APFS was sharing between trees that a per-tree `du` double-counts. Its one
 * weakness is stated where it is printed — anything else writing to the disk during the run moves it too.
 *
 * @param path any path on the filesystem to read
 * @returns free KiB, or `null` when `df` could not be read
 */
export function freeKib({ path }: { path: string }): number | null {
  try {
    const out = execFileSync("df", ["-k", path], {
      encoding: "utf8",
      maxBuffer: REMOVE_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: REMOVE_TIMEOUT_MS,
    });
    const columns = out.trim().split("\n").at(-1)!.split(/\s+/);
    const available = Number(columns[3]);
    return Number.isFinite(available) ? available : null;
  } catch {
    return null;
  }
}

/**
 * Clear the registrations git is still carrying for directories that no longer exist.
 *
 * @param repoRoot the repository to tidy
 * @returns git's refusal message, or `null` when the registrations were cleared
 */
export function pruneStaleRecords({ repoRoot }: { repoRoot: string }): string | null {
  return refusalOf({ args: ["worktree", "prune"], cwd: repoRoot });
}

/**
 * Render a removal that did not finish.
 *
 * @param name the tree's branch, or how a detached one is shown
 * @param outcome the failed outcome
 * @returns the FAILED line, with the path on its own line
 */
function renderFailed({ name, outcome }: { name: string; outcome: PruneOutcome }): string {
  if (outcome.declined === null) {
    // `whatWasLeft` always says what a failed removal left, so a failure without it is a defect, named as one.
    return `  FAILED ${name} — the removal did not finish, and what it left was not recorded\n    ${outcome.path}`;
  }
  return `  FAILED ${name} — the removal did not finish: ${outcome.declined}\n    ${outcome.path}`;
}

/**
 * How a result line names the tree. A tree checked out at a detached HEAD carries no branch to name, so the
 * line names that state instead.
 */
function outcomeTreeName({ outcome }: { outcome: PruneOutcome }): string {
  const { branch } = outcome;
  if (branch === null) {
    return "(detached)";
  }
  return branch;
}

/**
 * Render one outcome as a result line.
 *
 * @param outcome what happened to one worktree
 * @returns the line to print
 */
export function renderOutcome({ outcome }: { outcome: PruneOutcome }): string {
  const name = outcomeTreeName({ outcome });
  if (outcome.failed) {
    return renderFailed({ name, outcome });
  }
  if (!outcome.treeRemoved) {
    return `  KEPT ${name} — git declined: ${absentAs({ value: outcome.declined, whenAbsent: "no reason given" })}\n    ${outcome.path}`;
  }
  const branch = outcome.branchDeleted
    ? "tree and branch removed"
    : `tree removed, branch kept${outcome.declined === null ? "" : ` (${outcome.declined})`}`;
  const size = outcome.freedKib === 0 ? "" : `, ${(outcome.freedKib / 1_000_000).toFixed(1)} GB`;
  const salvaged =
    outcome.salvagedTo === null
      ? ""
      : `\n    work pushed to ${outcome.salvagedTo} — pull it into a fresh worktree to carry on`;
  return `  ${name} — ${branch}${size}${salvaged}`;
}
