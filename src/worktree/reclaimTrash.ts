/**
 * The reclaim trash — how a closed seat's worktree is removed in seconds rather than minutes, without ever
 * killing git half-way through one.
 *
 * ## Why removal was the slow part
 *
 * One slopweaver worktree is ~187k files, ~164k of them its `node_modules`
 * (`find <worktree> -xdev | wc -l`, then again with `-path ./node_modules -prune`). `git worktree remove`
 * deletes them one by one, which put `session close-done` at 55–119s whenever it reclaimed a seat and past the
 * supervisor tick's 120s reading budget on about half of ticks 702–748 of one chair (read
 * `.readings[] | select(.name=="close-done") | .child` from each tick directory's `capture.json`). A SIGKILL there lost
 * the whole report after the close was already journalled, and could land mid `git worktree remove`, the
 * PARTIALLY REMOVED tree `./pruneApply.ts` names.
 *
 * ## The asymmetry this module is built on
 *
 * Killing `git worktree remove` part-way guts a registered tree. Killing an `rm -rf` of a directory nobody
 * references is harmless: the next pass carries on where it stopped. So the bulk is RENAMED out first — one
 * atomic `rename` per directory, into a sibling of the worktrees on the same volume — git then deletes only
 * what is left, and the trash is emptied under a budget by {@link emptyReclaimTrash}, where an interruption
 * costs nothing. A detached `rm` would be simpler and is not available: `no-headless` NH001 bans every async
 * `child_process` spawn in this tree, so the delete is a bounded `spawnSync` instead.
 *
 * ## A batch is PENDING until git has removed its tree
 *
 * The same kill can land between the move and git's answer, and if git then refuses — a locked tree, say — the
 * only undo would have died with the process. So a batch carries a `pending.json` naming its worktree, the moves
 * and the process making them, written BEFORE the first rename and deleted only once `git worktree remove`
 * succeeded. The emptier never deletes a pending batch: while its writer lives it is in flight, and once the
 * writer is gone a batch whose worktree still exists is renamed back into it (reproduced by SIGTERM between the move and the restore of a locked tree). The marker is written
 * into a `.staging` directory that is then renamed to the batch's final name, so no batch ever exists under that
 * name without it: written in place, a batch sat 6–21ms with no marker, and an overlapping sweep read it as
 * committed and deleted the `node_modules` moved into it (reproduced 3 of 3).
 *
 * ## What may be moved, and why only that
 *
 * Only a `node_modules` directory git lists as WHOLLY ignored. Moving anything git's own clean check would
 * look at could hide dirt from it — `.yarn/` is the measured trap: git lists it, while `!.yarn/patches`
 * un-ignores part of it. An ignored directory carries nothing that check reads, so `git worktree remove`
 * without `--force` still refuses a dirty tree exactly as before, and on that refusal every move is put back.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { sleepSync } from "#lib/sleepSync.js";
import { holderIsAlive } from "../admit/lockHolder.js";
import { BULK_NAME, type BulkBatch, moveBulkAside, renameBack, restoreBulk } from "./bulkAside.js";
import { deleteLeaseRoot, GIT_LEASE_WAIT_MS, withDeleteLease } from "./deleteLease.js";
import { depsLockLocus, withDepsLock } from "./depsLock.js";
import { type FseventsdCpu, readFseventsdCpu } from "./fseventsdGauge.js";
import { worktreesDir } from "./location.js";
import { deleteGently } from "./prunePacing.js";
import { depositRecycled } from "./recyclePool.js";
import { commitBatch, dropBatch, readPending, STAGING_SUFFIX } from "./trashBatch.js";

/**
 * How long a staging batch with no readable marker is held before it is read as abandoned. Building one is a
 * `mkdir`, one small atomic write and a rename — milliseconds — so an hour is a bound on a wedged writer, not a
 * measurement of a slow one.
 */
const STAGING_GRACE_MS = 60 * 60_000;

/**
 * A repository's reclaim trash: inside its worktrees directory, so a `rename` into it never crosses a volume,
 * and ignored by both declared checkouts (`git check-ignore -v .claude/worktrees.noindex/.reclaim-trash/x`).
 * Dot-named so no reader of that directory takes it for a worktree; git lists worktrees from its own records.
 *
 * @param repoRoot the main checkout
 * @returns `<repoRoot>/.claude/worktrees.noindex/.reclaim-trash`
 */
export function reclaimTrashDir({ repoRoot }: { repoRoot: string }): string {
  return join(worktreesDir({ repoRoot }), ".reclaim-trash");
}

/**
 * Move a worktree's ignored bulk aside before git's removal, or say why the tree is kept: a move that stopped part-way
 * is put back, and the tree is not deleted in place.
 *
 * @param bulkTrash the trash root, or `undefined` for an in-place removal
 * @param worktree the worktree being removed
 * @returns the moved batch (`null` when nothing moved), or the refusal that keeps the tree
 */
function moveAsideFirst({
  bulkTrash,
  worktree,
}: {
  bulkTrash: string | undefined;
  worktree: string;
}): { kind: "ready"; batch: BulkBatch | null } | { kind: "kept"; refusal: string } {
  if (bulkTrash === undefined) {
    return { batch: null, kind: "ready" };
  }
  const aside = moveBulkAside({ nowMs: Date.now(), trashDir: bulkTrash, worktree });
  if (aside.kind !== "incomplete") {
    return { batch: aside.kind === "moved" ? aside.batch : null, kind: "ready" };
  }
  const kept = `its node_modules was not all moved aside (${aside.why}), so it was kept rather than deleted in place`;
  const unrestored = aside.batch === null ? [] : restoreBulk({ batch: aside.batch });
  if (unrestored.length === 0) {
    return { kind: "kept", refusal: kept };
  }
  return { kind: "kept", refusal: `${kept} — and could not be put back: ${unrestored.join("; ")}` };
}

/**
 * The refusal when no delete lease can be had at all. Git's delete has no bound, so it waits for a lease; the bulk
 * does not, so its moved batch is committed to the trash and a full disk still gets it back through the governed
 * emptier (`./deleteLease.ts`).
 *
 * @param batch the moved bulk, or `null`
 * @param why why the lease could not be taken
 * @returns the refusal naming what was kept
 */
function unleasedRefusal({ batch, why }: { batch: BulkBatch | null; why: string }): string {
  const unleased = `the machine's delete lease could not be taken (${why}), so git's in-place delete did not run`;
  if (batch === null) {
    return `${unleased} and the tree was kept`;
  }
  commitBatch({ dir: batch.dir });
  return `${unleased}: its node_modules went to the trash and the tracked tree was kept`;
}

/**
 * Put a moved bulk back after git refused the removal.
 *
 * @param batch the moved bulk
 * @param refusal git's refusal, or the lease's
 * @returns the refusal, naming any directory that could not be put back
 */
function putBackRefused({ batch, refusal }: { batch: BulkBatch; refusal: string }): string {
  const unrestored = restoreBulk({ batch });
  if (unrestored.length === 0) {
    return refusal;
  }
  return `${refusal} — and its ignored node_modules could not be put back: ${unrestored.join("; ")}`;
}

/**
 * The part of a removal that runs holding the worktree's deps lock: the move aside, git's removal, and the put-back
 * when git refuses. What it answers is the batch to commit — only when git removed the tree — and git's refusal. With
 * no delete lease to be had at all, it commits the moved bulk itself and keeps the tracked tree.
 *
 * @param bulkTrash the trash root, or `undefined` for an in-place removal
 * @param worktree the worktree being removed
 * @param remove runs `git worktree remove` and answers its refusal, or `null` when the tree went
 * @returns the committable batch or `null`, and the refusal naming any directory that could not be put back
 */
function removeUnderLock({
  bulkTrash,
  worktree,
  remove,
}: {
  bulkTrash: string | undefined;
  worktree: string;
  remove: () => string | null;
}): { batch: BulkBatch | null; refusal: string | null } {
  const first = moveAsideFirst({ bulkTrash, worktree });
  if (first.kind === "kept") {
    return { batch: null, refusal: first.refusal };
  }
  const { batch } = first;
  // Git's in-place delete of the tracked tree and build output takes the same lease every governed delete does, so it
  // never runs beside one, nor beside another tree's.
  const leased = withDeleteLease({ act: remove, root: deleteLeaseRoot(), sleep: sleepSync, waitMs: GIT_LEASE_WAIT_MS });
  if (leased.kind === "unavailable") {
    return { batch: null, refusal: unleasedRefusal({ batch, why: leased.why }) };
  }
  const refusal =
    leased.kind === "ran"
      ? leased.value
      : "another delete held the machine's delete lease, so it was kept for the next run rather than deleted beside it";
  if (batch === null || refusal === null) {
    return { batch, refusal };
  }
  return { batch: null, refusal: putBackRefused({ batch, refusal }) };
}

/**
 * Remove a worktree with its ignored `node_modules` moved aside first: moved, removed, then committed on success
 * or put back on a refusal. With no trash named, the removal runs in place and nothing moves.
 *
 * Moved AFTER every re-check the caller makes and BEFORE git's own: an ignored directory is invisible to the clean
 * check `git worktree remove` runs, so its refusal of a dirty tree stands exactly as it did (this module's header).
 *
 * Once git has removed the tree, an eligible root `node_modules` is offered to the recycle pool BEFORE the batch
 * is committed (`./recyclePool.ts`). That order is the safety: a pending batch is never deleted while its writer
 * lives, by any emptier of any vintage, so no `rm -rf` can be part-way through the tree as it moves. A declined
 * deposit leaves it in the batch, deleted later exactly as before; a refused removal never reaches the pool.
 *
 * @param bulkTrash the trash root, or `undefined` for an in-place removal
 * @param recyclePool the repository's recycle pool, or `undefined` to recycle nothing
 * @param worktree the worktree being removed
 * @param remove runs `git worktree remove` and answers its refusal, or `null` when the tree went
 * @returns git's refusal — naming any directory that could not be put back — or the deps lock's when a provision
 *   holds it, or `null` when the tree was removed
 */
export function removeWithBulkAside({
  bulkTrash,
  recyclePool,
  worktree,
  remove,
}: {
  bulkTrash: string | undefined;
  recyclePool?: string | undefined;
  worktree: string;
  remove: () => string | null;
}): string | null {
  const { batch, refusal } = heldRemoval({ bulkTrash, remove, worktree });
  if (batch === null) {
    return refusal;
  }
  // The tree is in a pending batch now, out of every provision's reach, so the deposit needs no lock — and could
  // not take one: git removed the git directory the lock lives in.
  const root = batch.moves.find((move) => move.from === join(worktree, BULK_NAME));
  if (recyclePool !== undefined && root !== undefined && batch.rootIdentity?.kind === "eligible") {
    // Opportunistic: a declined deposit — pool full, another volume — leaves the tree in this batch, which the
    // commit below hands to the emptier exactly as if no pool existed.
    depositRecycled({ entryName: basename(batch.dir), pool: recyclePool, source: root.to });
  }
  commitBatch({ dir: batch.dir });
  return null;
}

/**
 * {@link removeUnderLock} holding the worktree's deps lock (`./depsLock.ts`), taken once and never waited on.
 *
 * A provision installing into this tree holds that lock, so the removal is REFUSED rather than run: moved aside, a
 * half-written tree could reach the recycle pool, and removed in place, git would delete what yarn is writing. Held
 * from the move to git's answer, no provision can start in between and lose its tree to git.
 * A tree whose git directory cannot be resolved is handed to git in place with NOTHING moved aside, so it never
 * reaches the pool: the lock cannot be asked, and a provision may still hold one taken before `.git` broke.
 *
 * @param bulkTrash the trash root, or `undefined` for an in-place removal
 * @param worktree the worktree being removed
 * @param remove runs `git worktree remove` and answers its refusal, or `null` when the tree went
 * @returns the committable batch or `null`, and the refusal — the lock's own when a provision holds it
 */
function heldRemoval({
  bulkTrash,
  worktree,
  remove,
}: {
  bulkTrash: string | undefined;
  worktree: string;
  remove: () => string | null;
}): { batch: BulkBatch | null; refusal: string | null } {
  const locus = depsLockLocus({ worktree });
  if (locus.isErr()) {
    // Nothing is moved or removed: a provision may have taken the lock before this tree's `.git` became unreadable,
    // so an unresolvable locus proves nothing about who is writing `node_modules` now, and a
    // `.git` restored before git ran would let it delete the tree under a live install. Git
    // refuses to remove a tree whose `.git` does not resolve anyway, so the refusal costs nothing it could have done.
    return { batch: null, refusal: `its deps lock cannot be resolved, so it was not removed: ${locus.error}` };
  }
  const held = withDepsLock({ act: () => removeUnderLock({ bulkTrash, remove, worktree }), waitMs: 0, worktree });
  if (held.isErr()) {
    return { batch: null, refusal: `a provision holds its node_modules, so it was not removed: ${held.error}` };
  }
  return held.value;
}

/** What one emptying pass got through. */
export interface TrashEmptied {
  /** Batches deleted outright. */
  readonly emptied: number;
  /** Batches still on disk — pending, not reached inside the budget, or cut short by it — for the next pass. */
  readonly left: number;
  /** Pending batches whose writer died before its removal finished, renamed back into their still-present tree. */
  readonly restored: number;
}

/**
 * What to do with one STAGING batch. It never holds a move, so it is deletable once its writer is gone. Until
 * its marker is readable nothing says who that writer is, so it is held — but only for
 * {@link STAGING_GRACE_MS}: its writer either published it or failed well inside that, and a kill between the
 * `mkdir` and the marker leaves one with no marker for good.
 *
 * @param dir the staging directory
 * @returns `hold` while its writer may still be building it, else `delete`
 */
function settleStaging({ dir }: { dir: string }): "delete" | "hold" {
  const pending = readPending({ dir });
  if (!("kind" in pending)) {
    return holderIsAlive({ pid: pending.pid, start: pending.start }) ? "hold" : "delete";
  }
  const built = statSync(dir, { throwIfNoEntry: false });
  const abandoned = built !== undefined && Date.now() - built.mtimeMs >= STAGING_GRACE_MS;
  return abandoned ? "delete" : "hold";
}

/**
 * What to do with one batch before any deletion: hold it, restore it, or let it be deleted.
 *
 * @param dir the batch directory
 * @returns `hold` for a batch in flight or unreadable, `restored` when it went back into its tree, else `delete`
 */
function settlePending({ dir }: { dir: string }): "delete" | "hold" | "restored" {
  if (dir.endsWith(STAGING_SUFFIX)) {
    return settleStaging({ dir });
  }
  const pending = readPending({ dir });
  if ("kind" in pending) {
    return pending.kind === "committed" ? "delete" : "hold";
  }
  if (holderIsAlive({ pid: pending.pid, start: pending.start })) {
    return "hold";
  }
  if (!existsSync(pending.worktree)) {
    commitBatch({ dir });
    return "delete";
  }
  // Put back under the tree's deps lock, so a provision that started after the removal died never has this land in
  // the `node_modules` it is writing; a lock held or unresolvable leaves the batch pending for the next pass.
  const failures = withDepsLock({
    act: () => renameBack({ moves: pending.moves, worktree: pending.worktree }),
    waitMs: 0,
    worktree: pending.worktree,
  });
  if (failures.isErr() || failures.value.length > 0) {
    return "hold";
  }
  dropBatch({ dir });
  return existsSync(dir) ? "delete" : "restored";
}

/**
 * Delete every committed batch under the given trash roots, stopping when the budget is spent or the machine
 * is too loaded to take another.
 *
 * A batch the budget or the load cuts short is simply left for the next pass: nothing references it, so a
 * half-deleted one is only a smaller one. A pending batch is never deleted while it is pending (this module's
 * header). An absent root is an empty one — a checkout that has never reclaimed a seat. The delete itself runs at
 * background priority (`./prunePacing.ts`), because one batch is a whole `node_modules` of millions of files.
 *
 * @param roots every trash root to empty
 * @param budgetMs how long this pass may spend deleting, in total
 * @param maxDeletes how many batches this pass may delete, so a backlog drains one tree at a time between pauses
 * @param paused why no further batch may be deleted right now, read before each one, or null to carry on
 * @param now the epoch millisecond the budget is read against, here and inside the governed delete; the wall clock
 *   unless a test passes a fixed one
 * @param gauge fseventsd's CPU for the DEFAULT governed delete only, ignored when `deleteTree` is passed; the
 *   machine's live read unless a test passes a fixed one, so the default can be proven wired without the machine's
 *   load deciding the outcome
 * @param deleteTree removes one batch within a timeout and says whether it is gone; the governed
 *   {@link deleteGently} over `gauge` and `now`, unless a test passes its own
 * @returns how many batches went, how many went back into their tree, and how many are left
 */
export function emptyReclaimTrash({
  roots,
  budgetMs,
  maxDeletes,
  paused,
  now = Date.now,
  gauge = readFseventsdCpu,
  deleteTree = ({ dir, timeoutMs }) => deleteGently({ dir, gauge, now, timeoutMs }),
}: {
  roots: readonly string[];
  budgetMs: number;
  maxDeletes: number;
  paused: () => string | null;
  now?: () => number;
  gauge?: (input: { remainingMs: number }) => FseventsdCpu;
  deleteTree?: (input: { dir: string; timeoutMs: number }) => boolean;
}): TrashEmptied {
  const deadline = now() + budgetMs;
  const tally = { emptied: 0, left: 0, restored: 0 };
  // Counts every delete STARTED, not every one that finished: a batch that will not go — a read-only directory in
  // it, say — must not let the pass run on to the next one with no limit.
  let started = 0;
  const capped = (): string | null => {
    if (started >= maxDeletes) {
      return "this pass's batch limit";
    }
    const why = paused();
    started += why === null ? 1 : 0;
    return why;
  };
  for (const root of roots) {
    let batches: readonly string[];
    try {
      batches = readdirSync(root);
    } catch {
      continue;
    }
    for (const batch of batches) {
      tally[emptyOneBatch({ deadline, deleteTree, dir: join(root, batch), now, paused: capped })] += 1;
    }
  }
  return tally;
}

/** What a settle-only pass did: batches put back into a tree git kept, and batches waiting for a deleting pass. */
export interface TrashSettled {
  /** Pending batches whose writer died before its removal finished, renamed back into their still-present tree. */
  readonly restored: number;
  /** Batches still on disk — deletable, pending or held — for the next `worktree prune --apply` to delete. */
  readonly waiting: number;
}

/**
 * Settle every batch under the given trash roots — restore an orphaned pending one, commit one whose tree is gone —
 * and DELETE NOTHING.
 *
 * `session close-done` calls this instead of {@link emptyReclaimTrash}: one batch is a seat's whole `node_modules`,
 * which its 45-second reading budget could not finish, so every sweep started a delete the budget then cut short and
 * the trash grew by a batch per closed seat (325 batches in slopweaver's trash;
 * `find <repo>/.claude/worktrees.noindex/.reclaim-trash -mindepth 1 -maxdepth 1 | wc -l`). The delete belongs to the prune's
 * tail, which has no batch limit and a window of its own (`../cli/commands/worktree/pruneApplyPass.ts`). Settling
 * stays here because a restore is time-critical — a tree git kept is missing its `node_modules` until it runs.
 *
 * @param roots every trash root to settle
 * @returns how many batches went back into their tree and how many wait for a deleting pass
 */
export function settleReclaimTrash({ roots }: { roots: readonly string[] }): TrashSettled {
  const tally = { restored: 0, waiting: 0 };
  for (const root of roots) {
    let batches: readonly string[];
    try {
      batches = readdirSync(root);
    } catch {
      continue;
    }
    for (const batch of batches) {
      tally[settlePending({ dir: join(root, batch) }) === "restored" ? "restored" : "waiting"] += 1;
    }
  }
  return tally;
}

/**
 * Settle one batch, then delete it if it is deletable, the budget still has time and nothing pauses the pass.
 *
 * @param dir the batch directory
 * @param deadline the epoch millisecond the whole pass must stop deleting by
 * @param now the clock the deadline is read against
 * @param paused why no batch may be deleted right now, or null
 * @param deleteTree removes the batch within a timeout and says whether it is gone
 * @returns which count this batch belongs to
 */
function emptyOneBatch({
  dir,
  deadline,
  now,
  paused,
  deleteTree,
}: {
  dir: string;
  deadline: number;
  now: () => number;
  paused: () => string | null;
  deleteTree: (input: { dir: string; timeoutMs: number }) => boolean;
}): keyof TrashEmptied {
  const settled = settlePending({ dir });
  if (settled === "hold") {
    return "left";
  }
  if (settled === "restored") {
    return "restored";
  }
  const remaining = deadline - now();
  if (remaining <= 0 || paused() !== null) {
    return "left";
  }
  return deleteTree({ dir, timeoutMs: remaining }) ? "emptied" : "left";
}
