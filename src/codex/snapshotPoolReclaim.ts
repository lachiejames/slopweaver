/**
 * Remove ONE snapshot pool, the one a description review's own packet repository minted, once every pass of that
 * review has finished.
 *
 * ## Why a pool is ever removed
 *
 * A pool (`./snapshotPool.ts`) is kept so a repository's next pass reuses its slots. `github pr review-prepare`
 * builds a fresh packet repository for every description it reviews, and the pool is keyed by the repository's
 * common git dir, so each preparation mints a pool under the OS temp folder that no later pass ever leases from.
 * Nothing removed them, so they built up one per prepared description.
 *
 * ## The authority, and the lock
 *
 * The caller passes the `poolRoot` its own acquire returned (`TreeSnapshot.poolRoot`). This module never derives a
 * pool path and never lists the pools directory, so no other run's pool can be reached from here.
 *
 * There is no pool-wide lock: the lease is one marker per slot (`./snapshotLease.ts`). So removal takes EVERY
 * slot's lease first, minting a placeholder for each absent index so no acquirer can fill a gap mid-removal. It is
 * FAIL-CLOSED: one slot whose holder is not proven dead, one unknown marker, one lost rename, or any entry in the
 * pool directory the pool does not write (a `.mint-` in flight) stops it. Then nothing is removed bar this run's
 * own placeholders, every real slot it claimed goes back to `state.free`, and the failure is reported.
 *
 * Holding all eight, it deregisters each slot's tree from the packet repository, renames the whole pool directory
 * aside, and removes that. The rename is the boundary: a pass that mints a NEW pool at the same path afterwards
 * owns a different directory, which this never touches. The witness then checks that the renamed directory is
 * gone and that git lists none of the slot trees, and the act is journalled in the reclaim ledger.
 *
 * Nothing here throws, and nothing here moves a verdict: the caller reports the outcome beside it.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { findWorktreeAtPath, parseWorktreeListPorcelain } from "../cmux/worktreeList.js";
import { appendReclaimRow } from "../home/reclaim/journalStore.js";
import { sizeScratch } from "../home/reclaim/run.js";
import { SNAPSHOT_POOL_IDENTITY_FILE, SNAPSHOT_POOL_SLOTS } from "../worktree/snapshotPoolPath.js";
import { GIT_TREE_WRITE_TIMEOUT_MS, runGitChecked } from "./gitRun.js";
import { snapshotGitPrefix } from "./snapshot.js";
import type { SnapshotGit } from "./snapshotCheckout.js";
import { claimSlotForRemoval, type RemovalBlock, type RemovalSlotClaim, releaseHeldSlot } from "./snapshotLease.js";

/** The ledger's root and class for this act, distinct from every `home reclaim` root. */
const LEDGER_ROOT = "snapshot-pool";
const LEDGER_TAKES = "description-review-pool";

/** A slot left in place, and why. */
export interface HeldSlotBlock {
  readonly index: number;
  readonly reason: RemovalBlock;
}

/** The pool holds a slot this run may not take. */
export interface PoolSlotHeldError {
  readonly code: "POOL_SLOT_HELD";
  readonly message: string;
  readonly blocked: readonly HeldSlotBlock[];
}

/** The pool directory holds an entry the pool does not write. */
export interface PoolUnexpectedEntryError {
  readonly code: "POOL_UNEXPECTED_ENTRY";
  readonly message: string;
  readonly entries: readonly string[];
}

/** Git would not deregister a slot's tree. */
export interface PoolDeregisterFailedError {
  readonly code: "POOL_DEREGISTER_FAILED";
  readonly message: string;
  readonly index: number;
}

/** Sizing, renaming or removing the pool directory failed. */
export interface PoolRemoveFailedError {
  readonly code: "POOL_REMOVE_FAILED";
  readonly message: string;
}

/** After removal, the directory or a slot's registration is still there. */
export interface PoolWitnessFailedError {
  readonly code: "POOL_WITNESS_FAILED";
  readonly message: string;
}

/** The pool is gone but the ledger row could not be written. */
export interface PoolLedgerFailedError {
  readonly code: "POOL_LEDGER_FAILED";
  readonly message: string;
}

/** Every way removing a pool can stop. */
export type SnapshotPoolReclaimError =
  | PoolSlotHeldError
  | PoolUnexpectedEntryError
  | PoolDeregisterFailedError
  | PoolRemoveFailedError
  | PoolWitnessFailedError
  | PoolLedgerFailedError;

/** Factories for {@link SnapshotPoolReclaimError}, so every message is worded once. */
export const SnapshotPoolReclaimErrors = {
  deregisterFailed: ({ index, detail }: { index: number; detail: string }): PoolDeregisterFailedError => ({
    code: "POOL_DEREGISTER_FAILED",
    index,
    message: `git would not deregister slot-${String(index)}'s tree (${detail}); the pool was left in place`,
  }),
  ledgerFailed: ({ detail }: { detail: string }): PoolLedgerFailedError => ({
    code: "POOL_LEDGER_FAILED",
    message: `the pool was removed but its reclaim-ledger row could not be written (${detail})`,
  }),
  removeFailed: ({ detail }: { detail: string }): PoolRemoveFailedError => ({
    code: "POOL_REMOVE_FAILED",
    message: `the pool directory could not be removed (${detail})`,
  }),
  slotHeld: ({ blocked }: { blocked: readonly HeldSlotBlock[] }): PoolSlotHeldError => ({
    blocked,
    code: "POOL_SLOT_HELD",
    message: `left the pool in place: ${blocked.map((b) => `slot-${String(b.index)} ${b.reason}`).join(", ")}`,
  }),
  unexpectedEntry: ({ entries }: { entries: readonly string[] }): PoolUnexpectedEntryError => ({
    code: "POOL_UNEXPECTED_ENTRY",
    entries,
    message: `left the pool in place: it holds ${String(entries.length)} entr(ies) the pool does not write`,
  }),
  witnessFailed: ({ detail }: { detail: string }): PoolWitnessFailedError => ({
    code: "POOL_WITNESS_FAILED",
    message: `the pool removal's witness failed: ${detail}`,
  }),
} as const;

/** What a completed removal freed. */
export interface PoolReclaimed {
  readonly freedBytes: number;
  /** Slot directories that existed before the removal took them, placeholders not counted. */
  readonly removedSlots: number;
}

/**
 * The entries of a pool directory that the pool itself does not write — pure. The identity file and
 * `slot-<k>` for every index under the cap are expected. Anything else, a `.mint-` in flight or a half-written
 * `.identity-`, is somebody else's moment and blocks the removal.
 *
 * @param entries the pool directory's entries
 * @returns the unexpected ones, empty when the directory holds only what the pool writes
 */
export function unexpectedPoolEntries({ entries }: { entries: readonly string[] }): readonly string[] {
  const expected = new Set([
    SNAPSHOT_POOL_IDENTITY_FILE,
    ...Array.from({ length: SNAPSHOT_POOL_SLOTS }, (_, index) => `slot-${String(index)}`),
  ]);
  return entries.filter((entry) => !expected.has(entry));
}

/**
 * Remove the one pool at `poolRoot`, under every slot's lease, then witness and journal it.
 *
 * @param poolRoot the pool directory this run's own acquire returned, never one rebuilt or listed
 * @param repoRoot the packet repository the slots are registered against
 * @param ledgerPath the reclaim ledger the act is journalled into
 * @param nowIso the clock the ledger row is stamped with
 * @param session who ran it, for the ledger row
 * @param git the git seam; production runs `runGitChecked`
 * @returns what was freed, or why the pool, or part of it, was left in place
 */
export function reclaimSnapshotPool({
  poolRoot,
  repoRoot,
  ledgerPath,
  nowIso,
  session,
  git = runGitChecked,
}: {
  poolRoot: string;
  repoRoot: string;
  ledgerPath: string;
  nowIso: () => string;
  session: string;
  git?: SnapshotGit;
}): Result<PoolReclaimed, SnapshotPoolReclaimError> {
  if (!existsSync(poolRoot)) {
    return ok({ freedBytes: 0, removedSlots: 0 });
  }
  const whole = holdWholePool({ git, poolRoot, repoRoot });
  if (whole.isErr()) {
    return err(whole.error);
  }
  const { bytes, held } = whole.value;
  const removed = removeAside({ held, poolRoot });
  if (removed.isErr()) {
    return err(removed.error);
  }
  const witnessed = witness({ git, held, removed: removed.value, repoRoot });
  if (witnessed.isErr()) {
    return err(witnessed.error);
  }
  const reclaimed = { freedBytes: bytes, removedSlots: held.filter((claim) => claim.existed).length };
  const journalled = appendReclaimRow({
    path: ledgerPath,
    row: {
      atIso: nowIso(),
      freedBytes: reclaimed.freedBytes,
      removedEntries: reclaimed.removedSlots,
      root: LEDGER_ROOT,
      session,
      takes: LEDGER_TAKES,
      witnessHeld: true,
    },
  });
  if (journalled.isErr()) {
    return err(SnapshotPoolReclaimErrors.ledgerFailed({ detail: journalled.error.message }));
  }
  return ok(reclaimed);
}

/** One slot this removal holds the lease on. */
type ClaimedSlot = Extract<RemovalSlotClaim, { kind: "claimed" }>;

/**
 * Take every slot's lease, check the directory holds only what the pool writes, size it, and deregister every
 * slot's tree — or, on the first thing that stops it, put every claim back and say why. Nothing is removed here.
 */
function holdWholePool({
  git,
  poolRoot,
  repoRoot,
}: {
  git: SnapshotGit;
  poolRoot: string;
  repoRoot: string;
}): Result<{ bytes: number; held: readonly ClaimedSlot[] }, SnapshotPoolReclaimError> {
  const claims = Array.from({ length: SNAPSHOT_POOL_SLOTS }, (_, index) => claimSlotForRemoval({ index, poolRoot }));
  const held = claims.filter((claim): claim is ClaimedSlot => claim.kind === "claimed");
  const ready = readyToRemove({ claims, git, held, poolRoot, repoRoot });
  if (ready.isErr()) {
    undoClaims({ claims, poolRoot });
    return err(ready.error);
  }
  return ok({ bytes: ready.value, held });
}

/** Every check before the removal, in order, answering the pool's size once all of them hold. */
function readyToRemove({
  claims,
  git,
  held,
  poolRoot,
  repoRoot,
}: {
  claims: readonly RemovalSlotClaim[];
  git: SnapshotGit;
  held: readonly ClaimedSlot[];
  poolRoot: string;
  repoRoot: string;
}): Result<number, SnapshotPoolReclaimError> {
  const blocked = claims.flatMap((claim, index) => (claim.kind === "blocked" ? [{ index, reason: claim.reason }] : []));
  if (blocked.length > 0) {
    return err(SnapshotPoolReclaimErrors.slotHeld({ blocked }));
  }
  let unexpected: readonly string[];
  try {
    unexpected = unexpectedPoolEntries({ entries: readdirSync(poolRoot) });
  } catch (error: unknown) {
    return err(SnapshotPoolReclaimErrors.removeFailed({ detail: errorMessage({ error }) }));
  }
  if (unexpected.length > 0) {
    return err(SnapshotPoolReclaimErrors.unexpectedEntry({ entries: unexpected }));
  }
  const sized = sizeScratch({ absolute: dirname(poolRoot), relativePath: basename(poolRoot) });
  if (sized.isErr()) {
    return err(SnapshotPoolReclaimErrors.removeFailed({ detail: sized.error.message }));
  }
  return deregisterAll({ git, held, repoRoot }).map(() => sized.value.bytes);
}

/**
 * Put every claim back: a real slot's lease returns to `state.free`, and a placeholder this run minted is
 * removed, since it holds nothing but this run's own marker.
 */
function undoClaims({ claims, poolRoot }: { claims: readonly RemovalSlotClaim[]; poolRoot: string }): void {
  for (const claim of claims) {
    if (claim.kind !== "claimed") {
      continue;
    }
    if (claim.existed) {
      releaseHeldSlot({ held: claim.held });
      continue;
    }
    try {
      const trash = join(poolRoot, `.trash-${randomUUID()}`);
      renameSync(claim.held.slot, trash);
      rmSync(trash, { force: true, recursive: true });
    } catch {
      // Left in place, the placeholder carries this process's busy marker, so it reads as a dead holder's once
      // this process exits and the next acquirer rebuilds it.
    }
  }
}

/** Deregister every held slot whose tree is there, stopping at the first that git refuses. */
function deregisterAll({
  git,
  held,
  repoRoot,
}: {
  git: SnapshotGit;
  held: readonly ClaimedSlot[];
  repoRoot: string;
}): Result<true, SnapshotPoolReclaimError> {
  for (const [index, claim] of held.entries()) {
    if (!existsSync(claim.held.tree)) {
      continue;
    }
    try {
      git({
        args: [
          ...snapshotGitPrefix({ staging: claim.held.slot }),
          "worktree",
          "remove",
          "--force",
          "--force",
          claim.held.tree,
        ],
        cwd: repoRoot,
        label: "git worktree remove",
        timeoutMs: GIT_TREE_WRITE_TIMEOUT_MS,
      });
    } catch (error: unknown) {
      return err(SnapshotPoolReclaimErrors.deregisterFailed({ detail: errorMessage({ error }), index }));
    }
  }
  return ok(true);
}

/**
 * Rename the pool directory aside, then remove it, so a pool minted at the same path afterwards is never reached.
 * A refused rename leaves the pool where it was, so every claim goes back; once renamed, the claims went with it.
 */
function removeAside({
  held,
  poolRoot,
}: {
  held: readonly ClaimedSlot[];
  poolRoot: string;
}): Result<string, SnapshotPoolReclaimError> {
  const trash = join(dirname(poolRoot), `.trash-${randomUUID()}`);
  try {
    renameSync(poolRoot, trash);
  } catch (error: unknown) {
    undoClaims({ claims: held, poolRoot });
    return err(SnapshotPoolReclaimErrors.removeFailed({ detail: errorMessage({ error }) }));
  }
  try {
    rmSync(trash, { force: true, recursive: true });
  } catch (error: unknown) {
    return err(SnapshotPoolReclaimErrors.removeFailed({ detail: errorMessage({ error }) }));
  }
  return ok(trash);
}

/** Prove the renamed directory is gone and that git lists none of the slot trees it held. */
function witness({
  git,
  held,
  removed,
  repoRoot,
}: {
  git: SnapshotGit;
  held: readonly ClaimedSlot[];
  removed: string;
  repoRoot: string;
}): Result<true, SnapshotPoolReclaimError> {
  if (existsSync(removed)) {
    return err(SnapshotPoolReclaimErrors.witnessFailed({ detail: "the renamed pool directory is still there" }));
  }
  let listed: string;
  try {
    listed = git({ args: ["worktree", "list", "--porcelain"], cwd: repoRoot, label: "git worktree list" });
  } catch (error: unknown) {
    return err(
      SnapshotPoolReclaimErrors.witnessFailed({ detail: `git worktree list failed: ${errorMessage({ error })}` }),
    );
  }
  const worktrees = parseWorktreeListPorcelain({ text: listed });
  const still = held.filter((claim) => findWorktreeAtPath({ path: claim.held.tree, worktrees }) !== undefined);
  if (still.length > 0) {
    return err(
      SnapshotPoolReclaimErrors.witnessFailed({ detail: `git still lists ${String(still.length)} slot tree(s)` }),
    );
  }
  return ok(true);
}
