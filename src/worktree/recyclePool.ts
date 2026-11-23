/**
 * The recycle pool — a removed worktree's root `node_modules`, kept whole so the next worktree provisioned from
 * the same repository starts from it instead of from nothing.
 *
 * ## The measurement this is built on
 *
 * A fresh `yarn install` in a new slopweaver worktree took 67.8s, 64s of it the link step writing ~165k entries.
 * The same tree renamed into a second new worktree whose `yarn.lock` differed
 * by 304 lines installed in 5.1s, and the result was the SAME tree a fresh install there produces:
 * 165,698 entries each, an identical `find node_modules -exec stat -f '%HT %z %Y %N' {} + | sort` listing, every
 * regular file the same yarn-store inode, and `.yarn-state.yml` / `.package-map.json` byte-identical by `cmp`.
 * Reproduce: `git worktree add --detach <a> HEAD`, `yarn --cwd <a> install`, `git worktree add --detach <b>
 * <older sha>`, `mv <a>/node_modules <b>/`, `time yarn --cwd <b> install`, then a fresh control at `<older sha>`.
 * Yarn's node-modules linker diffs the tree against its own `.yarn-state.yml`, so a recycled tree pays only for
 * what changed — and until this module every removal deleted that tree and every provision rebuilt it.
 *
 * ## Why a pool of its own, and not the reclaim trash
 *
 * `./reclaimTrash.ts` already moves a removed tree's `node_modules` aside, but a committed trash batch is the
 * one thing every emptier — of EVERY vintage, since all checkouts on the machine share these directories —
 * `rm -rf`s. A claim racing one of those deletes would hand yarn a half-deleted tree whose `.yarn-state.yml`
 * still says it is whole. So the pool is a sibling directory NOTHING ever deletes from: an entry leaves only by
 * one `rename`, to a claimer or into the trash, and of two renames of the same source exactly one succeeds.
 *
 * ## Every step is one atomic call, and nothing is ever replaced
 *
 * - **A slot is a `mkdir`.** The pool is {@link RECYCLE_POOL_CAPACITY} fixed slot directories, `<pool>/0` and on;
 *   a deposit takes the first one whose `mkdir` succeeds and renames the tree into it, so two deposits can never
 *   both see room for one, and a full pool declines rather than evicting — eviction would only move the same
 *   deletion elsewhere. A claimer removes only the slot it emptied.
 * - **A claim reserves its destination with a `mkdir` too.** `rename` onto an EMPTY directory replaces it — and
 *   onto a symlink, the retired shared-deps shape — so the claim never renames onto a path it merely checked:
 *   it creates `<worktree>/node_modules` itself first (`EEXIST`: something is there, nothing is touched), and the
 *   only thing its rename can then replace is that empty directory of its own. Anything written into it meanwhile
 *   makes the rename fail `ENOTEMPTY` with both trees intact; the reservation is removed with `rmdir`, which
 *   refuses a directory that is not empty. Measured on APFS, Node 24, every case above: a rename
 *   over an own empty reservation lands, over a populated one fails `ENOTEMPTY` leaving both, a `mkdir` over a
 *   symlink or a directory fails `EEXIST`, a rename into a vanished slot fails `ENOENT` leaving the source.
 * - **Same volume, by construction.** It sits beside the worktrees it serves, as the trash does. A rename that
 *   crosses a volume anyway (`EXDEV`, a worktree at a non-conventional path) is a declined deposit or a skipped
 *   claim — never a recursive copy, which would cost what an install costs.
 * - **One repository's trees only.** A provision reads its own `repoRoot`'s pool, a tree is deposited only when
 *   its `.yarn-state.yml` names the root workspace of the `package.json` it was installed beside, and a claim
 *   checks that again against the destination's own manifest (`./recycleIdentity.ts`).
 *
 * A claimed tree is never trusted as installed: the caller still runs `yarn install`, writes the verified mark
 * and privatises native binaries, in that order, exactly as for an empty tree (`./provision.ts`).
 */
import { lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";

import { worktreesDir } from "./location.js";
import { stateNamesWorkspace, textOf, YARN_STATE_FILE } from "./recycleIdentity.js";

/**
 * How many trees one repository's pool holds. Each is ~165k directory entries but about 316 KiB on disk,
 * because every file in it is a hardlink into yarn's store (`.yarnrc.yml`'s `nmMode` measurement), so the cap
 * bounds inodes, not gigabytes. Four covers a burst of spawns after a prune.
 */
export const RECYCLE_POOL_CAPACITY = 4;

/**
 * Why a deposit or a claim did not move a tree. Each is a fact about the filesystem, never a policy refusal.
 *
 * @internal
 */
export type RecycleSkipReason =
  | "pool-empty"
  | "pool-full"
  | "pool-unreadable"
  | "destination-present"
  | "contended"
  | "cross-device"
  | "identity-mismatch"
  | "not-recyclable"
  | "rename-failed";

/** What one claim did: the pool entry now at the destination, or why provisioning starts from an empty tree. */
export type RecycleClaim =
  | { readonly kind: "claimed"; readonly from: string }
  | { readonly kind: "skipped"; readonly reason: RecycleSkipReason; readonly detail: string };

/** What one deposit did: the pool entry it made, or why the tree was left where it was. */
export type RecycleDeposit =
  | { readonly kind: "deposited"; readonly to: string }
  | { readonly kind: "declined"; readonly reason: RecycleSkipReason; readonly detail: string };

/**
 * A repository's recycle pool: inside its worktrees directory, beside the reclaim trash, so a `rename` into or
 * out of it never crosses a volume. Dot-named so no reader of that directory takes it for a worktree.
 *
 * @param repoRoot the main checkout
 * @returns `<repoRoot>/.claude/worktrees.noindex/.recycle-pool`
 */
export function recyclePoolDir({ repoRoot }: { repoRoot: string }): string {
  return join(worktreesDir({ repoRoot }), ".recycle-pool");
}

/** One tree waiting in the pool: the slot holding it, its own path, and when it was deposited. */
export interface PoolEntry {
  readonly slot: string;
  readonly path: string;
  readonly mtimeMs: number;
}

/**
 * Pool entries in the order a claim tries them: newest first, because the newest tree is the likeliest to be
 * closest to the lockfile being installed. Ties break on path so the order is total.
 *
 * @param entries every entry in the pool
 * @returns the same entries, newest first
 */
export function claimOrder({ entries }: { entries: readonly PoolEntry[] }): readonly PoolEntry[] {
  return entries.toSorted((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

/** The `code` a failed filesystem call carries, or the message when it has none. */
function failureOf({ error }: { error: unknown }): string {
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  if (typeof code === "string") {
    return code;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The reason a failed rename between pool and tree stops at, by its code. */
function renameReason({ failure }: { failure: string }): RecycleSkipReason {
  return failure === "EXDEV" ? "cross-device" : "rename-failed";
}

/**
 * Move one root `node_modules` into the first free slot of the pool.
 *
 * The caller has already found it eligible (`./recycleIdentity.ts`). Every decline leaves the tree exactly where it
 * was, so the caller's own path — the trash, then a delete — carries on unchanged.
 *
 * @param source the `node_modules` to deposit — a kept worktree's own, or its renamed copy in a pending trash batch
 * @param entryName the entry's name inside its slot, unique per deposit
 * @param pool the repository's {@link recyclePoolDir}
 * @returns the entry made, or why none was
 */
export function depositRecycled({
  source,
  entryName,
  pool,
}: {
  source: string;
  entryName: string;
  pool: string;
}): RecycleDeposit {
  if (lstatSync(source, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return { detail: `${source} is not a real directory`, kind: "declined", reason: "not-recyclable" };
  }
  try {
    mkdirSync(pool, { recursive: true });
  } catch (error: unknown) {
    return {
      detail: `the pool could not be made (${failureOf({ error })})`,
      kind: "declined",
      reason: "rename-failed",
    };
  }
  for (let index = 0; index < RECYCLE_POOL_CAPACITY; index += 1) {
    const slot = join(pool, String(index));
    try {
      mkdirSync(slot);
    } catch (error: unknown) {
      const failure = failureOf({ error });
      if (failure === "EEXIST") {
        continue;
      }
      return {
        detail: `slot ${String(index)} could not be taken (${failure})`,
        kind: "declined",
        reason: "rename-failed",
      };
    }
    const to = join(slot, entryName);
    try {
      renameSync(source, to);
      return { kind: "deposited", to };
    } catch (error: unknown) {
      const failure = failureOf({ error });
      quietly({
        act: () => {
          rmdirSync(slot);
        },
      });
      return {
        detail: `the rename into the pool failed (${failure})`,
        kind: "declined",
        reason: renameReason({ failure }),
      };
    }
  }
  return {
    detail: `all ${String(RECYCLE_POOL_CAPACITY)} slots hold a tree`,
    kind: "declined",
    reason: "pool-full",
  };
}

/**
 * Run one best-effort cleanup whose failure changes nothing the caller reports: an empty slot left behind holds
 * capacity until a claim or a deposit's rename frees it, and an unreleased reservation is an empty directory the
 * caller's own install then fills.
 */
function quietly({ act }: { act: () => void }): void {
  try {
    act();
  } catch {
    // See the contract above.
  }
}

/**
 * The filesystem a claim acts through, injected so the race and failure branches are driven by plain functions.
 * Each throws exactly as the `node:fs` call it wraps does.
 *
 * @internal
 */
export interface ClaimSeams {
  /** Every tree in the pool; an absent pool is an empty list, any other failure a throw. */
  readonly entries: (args: { pool: string }) => readonly PoolEntry[];
  /** Create one directory, never recursively, failing `EEXIST` when anything is at the path. */
  readonly reserve: (args: { path: string }) => void;
  /** Remove one directory, failing when it is not empty. */
  readonly release: (args: { path: string }) => void;
  /** Rename one path to another. */
  readonly rename: (args: { from: string; to: string }) => void;
  /** A file's text, or `undefined` when it cannot be read. */
  readonly read: (args: { path: string }) => string | undefined;
  /** Move a pool entry that does not fit this repository out of the pool, answering why it could not be. */
  readonly discard: (args: { dir: string }) => string | undefined;
}

/**
 * Take the newest pool entry that fits this repository into `destination`, never replacing anything there.
 *
 * `destination` is reserved first with a non-recursive `mkdir`, so the claim's rename can only ever replace this
 * claim's own empty directory (this module's header). Entries are then tried newest first: one whose state names
 * another root workspace is discarded from the pool and skipped, `ENOENT` means a concurrent claimer took it and
 * the next is tried, and any other failure ends the claim. An unclaimed reservation is removed again.
 *
 * @param pool the repository's {@link recyclePoolDir}
 * @param destination the worktree's `node_modules` path
 * @param packageName the worktree's root package name, which the entry's state must carry
 * @param seams the filesystem
 * @returns the entry claimed, or why provisioning starts empty
 */
export function claimRecycled({
  pool,
  destination,
  packageName,
  seams,
}: {
  pool: string;
  destination: string;
  packageName: string;
  seams: ClaimSeams;
}): RecycleClaim {
  let entries: readonly PoolEntry[];
  try {
    entries = claimOrder({ entries: seams.entries({ pool }) });
  } catch (error: unknown) {
    return {
      detail: `the pool could not be read (${failureOf({ error })})`,
      kind: "skipped",
      reason: "pool-unreadable",
    };
  }
  if (entries.length === 0) {
    return { detail: "the recycle pool is empty", kind: "skipped", reason: "pool-empty" };
  }
  try {
    seams.reserve({ path: destination });
  } catch (error: unknown) {
    const failure = failureOf({ error });
    const present = failure === "EEXIST";
    return {
      detail: present ? "this worktree already has a node_modules" : `it could not be reserved (${failure})`,
      kind: "skipped",
      reason: present ? "destination-present" : "rename-failed",
    };
  }
  const outcome = claimInto({ destination, entries, packageName, seams });
  if (outcome.kind === "skipped") {
    quietly({
      act: () => {
        seams.release({ path: destination });
      },
    });
  }
  return outcome;
}

/** The loop {@link claimRecycled} runs once its destination is reserved. */
function claimInto({
  destination,
  entries,
  packageName,
  seams,
}: {
  destination: string;
  entries: readonly PoolEntry[];
  packageName: string;
  seams: ClaimSeams;
}): RecycleClaim {
  const passed: string[] = [];
  let reason: RecycleSkipReason = "contended";
  for (const entry of entries) {
    const step = claimEntry({ destination, entry, packageName, seams });
    if (step.kind === "passed") {
      passed.push(step.note);
      reason = step.reason;
      continue;
    }
    if (step.kind === "claimed") {
      return step;
    }
    return { ...step, detail: [...passed, step.detail].join("; ") };
  }
  return { detail: passed.join("; "), kind: "skipped", reason };
}

/** One entry's outcome: claimed, a stop that ends the claim, or passed over for the next entry. */
type EntryStep = RecycleClaim | { kind: "passed"; note: string; reason: RecycleSkipReason };

/** Try one pool entry against the reserved destination. */
function claimEntry({
  destination,
  entry,
  packageName,
  seams,
}: {
  destination: string;
  entry: PoolEntry;
  packageName: string;
  seams: ClaimSeams;
}): EntryStep {
  const yarnStateText = seams.read({ path: join(entry.path, YARN_STATE_FILE) });
  // Deposits require the state file, so an entry without one readable is one a concurrent claim already took.
  if (yarnStateText === undefined) {
    return { kind: "passed", note: `${entry.path} was claimed by another provision`, reason: "contended" };
  }
  if (!stateNamesWorkspace({ packageName, yarnStateText })) {
    return discardForeign({ entry, packageName, seams });
  }
  try {
    seams.rename({ from: entry.path, to: destination });
  } catch (error: unknown) {
    return renameStep({ entry, error });
  }
  quietly({
    act: () => {
      seams.release({ path: entry.slot });
    },
  });
  return { from: entry.path, kind: "claimed" };
}

/** Move an entry installed for another root workspace out of the pool, freeing its slot when it went. */
function discardForeign({
  entry,
  packageName,
  seams,
}: {
  entry: PoolEntry;
  packageName: string;
  seams: ClaimSeams;
}): EntryStep {
  const discarded = seams.discard({ dir: entry.path });
  const foreign = `${entry.path} was not installed for ${packageName}`;
  if (discarded !== undefined) {
    return {
      kind: "passed",
      note: `${foreign}, and could not be discarded: ${discarded}`,
      reason: "identity-mismatch",
    };
  }
  quietly({
    act: () => {
      seams.release({ path: entry.slot });
    },
  });
  return { kind: "passed", note: `${foreign}, discarded`, reason: "identity-mismatch" };
}

/** What a failed claiming rename means: a concurrent claim passes the entry over, anything else stops the claim. */
function renameStep({ entry, error }: { entry: PoolEntry; error: unknown }): EntryStep {
  const failure = failureOf({ error });
  if (failure === "ENOENT") {
    return { kind: "passed", note: `${entry.path} was claimed by another provision`, reason: "contended" };
  }
  const stop = `claiming ${entry.path} failed (${failure})`;
  if (failure === "ENOTEMPTY" || failure === "EEXIST") {
    return {
      detail: `${stop}: something was written into the reservation`,
      kind: "skipped",
      reason: "destination-present",
    };
  }
  return { detail: stop, kind: "skipped", reason: renameReason({ failure }) };
}

/** The trees in one slot directory, empty when the slot has gone or holds none yet. */
function slotEntries({ slot }: { slot: string }): readonly PoolEntry[] {
  const stat = lstatSync(slot, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) {
    return [];
  }
  try {
    return readdirSync(slot).map((name) => ({ mtimeMs: stat.mtimeMs, path: join(slot, name), slot }));
  } catch {
    return [];
  }
}

/**
 * The real filesystem for {@link claimRecycled}.
 *
 * @param discard how a pool entry that does not fit leaves the pool
 * @returns the production seams
 */
export function productionClaimSeams({ discard }: { discard: ClaimSeams["discard"] }): ClaimSeams {
  return {
    discard,
    entries: ({ pool }) => {
      if (lstatSync(pool, { throwIfNoEntry: false }) === undefined) {
        return [];
      }
      return readdirSync(pool)
        .filter((name) => !name.startsWith("."))
        .flatMap((name) => slotEntries({ slot: join(pool, name) }));
    },
    read: ({ path }) => textOf({ path }),
    release: ({ path }) => {
      rmdirSync(path);
    },
    rename: ({ from, to }) => {
      renameSync(from, to);
    },
    reserve: ({ path }) => {
      mkdirSync(path);
    },
  };
}
