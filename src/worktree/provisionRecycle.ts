/**
 * The recycle pool's half of provisioning (`./provision.ts`): claim a fitting tree before the install, throw it
 * away and install from empty when the install over it fails, and say which happened.
 *
 * Why a recycled start is worth it, and why it can never replace anything already at the destination, is
 * `./recyclePool.ts`'s header; why the claim and `--deps shared`'s link take one lock is `./depsLock.ts`'s.
 */
import { rmSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { withDepsLock } from "./depsLock.js";
import { type WorktreeError, WorktreeErrors } from "./errors.js";
import { reclaimTrashDir } from "./reclaimTrash.js";
import { packageNameOf, textOf } from "./recycleIdentity.js";
import { claimRecycled, productionClaimSeams, type RecycleClaim, recyclePoolDir } from "./recyclePool.js";
import { discardIntoTrash } from "./trashBatch.js";

/**
 * What the recycle pool contributed to one install: a claimed tree yarn reconciled, a claimed tree the first
 * install failed over and that was thrown away before an install from empty, or why none was claimed.
 */
export type RecycledProvision = RecycleClaim | { readonly kind: "fresh-after-discard"; readonly from: string };

/**
 * How long `--deps shared` waits for an own-tree provision of the same worktree. That one holds the lock through a
 * whole `yarn install`, so a link meeting it gives up and says so rather than queueing behind minutes of yarn.
 */
const LINK_LOCK_WAIT_MS = 10_000;

/**
 * How long an own-tree provision waits for the lock. A link holds it while deleting the tree it replaces, which on
 * a populated `node_modules` is seconds, so this outlasts that and bounds only a wedged holder.
 */
const OWN_LOCK_WAIT_MS = 60_000;

/**
 * Throw one `node_modules` a provision will not install over into the repository's trash, for an emptier.
 *
 * @param dir the tree to throw away
 * @param path the worktree it belongs to, which names the trash batch
 * @param repoRoot the main checkout whose trash takes it
 * @returns why it could not be moved, or `undefined` once it is gone
 */
export function discardRecycledTree({
  dir,
  path,
  repoRoot,
}: {
  dir: string;
  path: string;
  repoRoot: string;
}): string | undefined {
  return discardIntoTrash({
    dir,
    label: `${basename(path)}-recycle-discard`,
    nowMs: Date.now(),
    trashDir: reclaimTrashDir({ repoRoot }),
  });
}

/**
 * Claim the repository's newest fitting recycled tree into a worktree's `node_modules`. Call it inside
 * {@link holdOwnTree}, which holds the worktree's deps lock from this claim to the end of the install.
 *
 * The claim reserves the destination itself, so a worktree that already has a `node_modules` — reused, or the
 * shared symlink — is never touched. The fit test is the root workspace yarn's state names, against this
 * worktree's own `package.json`.
 *
 * @param path the worktree whose `node_modules` the tree would become
 * @param repoRoot the main checkout whose pool is claimed from
 * @returns the tree claimed, or why the install starts empty
 */
export function claimRecycledTree({ path, repoRoot }: { path: string; repoRoot: string }): RecycleClaim {
  const packageName = packageNameOf({ manifestText: textOf({ path: join(path, "package.json") }) });
  if (packageName === undefined) {
    return {
      detail: "its package.json names no package to match a tree against",
      kind: "skipped",
      reason: "not-recyclable",
    };
  }
  return claimRecycled({
    destination: join(path, "node_modules"),
    packageName,
    pool: recyclePoolDir({ repoRoot }),
    seams: productionClaimSeams({ discard: ({ dir }) => discardRecycledTree({ dir, path, repoRoot }) }),
  });
}

/**
 * Run an own-tree provision's claim, install, install mark and exec-inode privatisation holding the worktree's
 * deps lock, so neither a `--deps shared` link nor a prune's drop (`./pruneDeps.ts`) replaces the tree while
 * yarn or the privatisation is writing it.
 *
 * Released between the claim and the install, the lock let a shared provision of the same path delete the claimed
 * tree and plant its symlink, and yarn then ran against the SHARED tree while this provision reported its own
 * installed. Released before the privatisation, it let the same link land
 * first and the privatisation relink binaries inside the shared tree.
 *
 * @param path the worktree whose `node_modules` is installed
 * @param act the claim-to-privatisation section
 * @returns what `act` returned, or an install failure naming the holder when the lock was not taken
 */
export function holdOwnTree<T>({
  path,
  act,
}: {
  path: string;
  act: () => Result<T, WorktreeError>;
}): Result<T, WorktreeError> {
  const held = withDepsLock({ act, waitMs: OWN_LOCK_WAIT_MS, worktree: path });
  if (held.isErr()) {
    return err(
      WorktreeErrors.installFailed({
        detail: `another process is replacing this worktree's node_modules, so nothing was installed: ${held.error}`,
        step: "install",
      }),
    );
  }
  return held.value;
}

/**
 * Replace a worktree's `node_modules` with a symlink to the shared tree, under the worktree's deps lock, so a
 * concurrent recycle claim of this same path never renames over the link this plants.
 *
 * @param path the worktree to link
 * @param sharedRoot the shared `node_modules` the link points at
 */
export function linkSharedUnderLock({ path, sharedRoot }: { path: string; sharedRoot: string }): void {
  const target = join(path, "node_modules");
  const linked = withDepsLock({
    act: () => {
      rmSync(target, { force: true, recursive: true });
      symlinkSync(sharedRoot, target);
    },
    waitMs: LINK_LOCK_WAIT_MS,
    worktree: path,
  });
  if (linked.isErr()) {
    throw new Error(`the shared node_modules was not linked: ${linked.error}`);
  }
}

/**
 * Run the install, starting from a recycled tree when one fits and from an empty one if an install over the
 * recycled tree fails, then mark the tree verified.
 *
 * The retry is the rollback the recycled start owes: a failure there may be the recycled tree's fault rather than
 * the lockfile's, so it is thrown into the trash and the install runs once more exactly as it did before the pool
 * existed. Only that second failure is reported — with the first one beside it. A tree that cannot be thrown away
 * is {@link WorktreeErrors.recycleFailed}, never a retry: an install over it would not be the clean one promised.
 *
 * @param claim take a recycled tree into the worktree, if one fits
 * @param install run the dependency install, answering its failure or `undefined`
 * @param discard throw the worktree's `node_modules` away, answering why it could not be or `undefined`
 * @param mark write the verified-install mark inside the tree, answering why it could not be or `undefined`
 * @returns what the pool contributed, or the install's typed failure
 */
export function installFromRecycled({
  claim,
  install,
  discard,
  mark,
}: {
  claim: () => RecycleClaim;
  install: () => string | undefined;
  discard: () => string | undefined;
  mark: () => string | undefined;
}): Result<RecycledProvision, WorktreeError> {
  const installed = installWithRollback({ claim, discard, install });
  if (installed.isErr()) {
    return installed;
  }
  // Yarn writes no file when an install changes nothing, so without this mark a re-provisioned worktree whose tree
  // already matched would report its dependencies STALE forever — `checkouts/installMark.ts`.
  const unmarked = mark();
  if (unmarked !== undefined) {
    return err(
      WorktreeErrors.installFailed({
        detail: `the install succeeded but its verified-install mark could not be written: ${unmarked}`,
        step: "install",
      }),
    );
  }
  return installed;
}

/** {@link installFromRecycled}'s install and its one rollback to an empty tree, before the mark. */
function installWithRollback({
  claim,
  install,
  discard,
}: {
  claim: () => RecycleClaim;
  install: () => string | undefined;
  discard: () => string | undefined;
}): Result<RecycledProvision, WorktreeError> {
  const recycled = claim();
  const failure = install();
  if (failure === undefined) {
    return ok(recycled);
  }
  if (recycled.kind !== "claimed") {
    return err(WorktreeErrors.installFailed({ detail: failure, step: "install" }));
  }
  const discarded = discard();
  if (discarded !== undefined) {
    return err(
      WorktreeErrors.recycleFailed({ discardFailure: discarded, from: recycled.from, installFailure: failure }),
    );
  }
  const retried = install();
  if (retried !== undefined) {
    return err(
      WorktreeErrors.installFailed({
        detail: `${retried}\n(and first over the recycled tree ${recycled.from}: ${failure})`,
        step: "install",
      }),
    );
  }
  return ok({ from: recycled.from, kind: "fresh-after-discard" });
}

/**
 * The line `worktree create` prints about where the install started.
 *
 * @param recycled what the pool contributed, `undefined` when this worktree's own tree was not installed
 * @returns one line, or none when nothing was installed
 */
export function recycledLines({ recycled }: { recycled: RecycledProvision | undefined }): readonly string[] {
  if (recycled === undefined) {
    return [];
  }
  if (recycled.kind === "claimed") {
    return [`  recycled: started from ${recycled.from}, reconciled by yarn`];
  }
  if (recycled.kind === "fresh-after-discard") {
    return [`  recycled: the install over ${recycled.from} failed, so it was discarded and the install rerun empty`];
  }
  return [`  recycled: none (${recycled.reason}), installed from empty — ${recycled.detail}`];
}
