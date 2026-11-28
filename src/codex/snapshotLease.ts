/**
 * The lease on one snapshot-pool slot: which process may move a slot's tree, decided by the kernel.
 *
 * ## The lease is one marker file, and every transition is ONE rename
 *
 * A slot directory `slot-<k>/` holds `tree/` and exactly one marker: `state.free` or
 * `state.busy.<pid>.<start>.<uuid>`. Acquire renames `state.free` to a fresh busy name; release renames that exact busy
 * name back; reaping a dead holder renames ITS exact busy name straight to the reaper's own. `rename(2)` has
 * one winner, so two processes can never both hold a slot. The uuid is load-bearing: with a
 * pid-only name, a reaper that judged pid 42 dead and paused could rename a NEW holder's marker after the OS
 * reused pid 42. With the uuid, the paused reaper's source name no longer exists and its rename simply loses.
 *
 * A new slot is minted as a private directory already holding its busy marker and renamed into `slot-<k>`, so
 * a slot directory never exists without a marker. A slot that does not read as exactly one known marker is
 * skipped, never guessed free.
 *
 * A holder is alive only when its pid answers AND that pid's process start time still hashes to `<start>`. The
 * pid alone would leave a dead holder's slot leased for as long as an unrelated process had inherited the pid, and a holder that exited but was never reaped — a zombie, which answers `kill(pid, 0)` and keeps
 * its start time — is dead too. Both are the one probe every holder check in the tree reads,
 * `../talk/relayLease.ts`'s `processStartOf`, whose start text this module digests into the marker.
 *
 * Three residues read a dead holder as alive, each accepted. When `ps` cannot answer at all, the holder is
 * presumed alive. `lstart` has one-second resolution, so a pid reused within the same second as its dead holder
 * started matches — it needs the whole pid space to wrap inside that second. And a reused pid whose different
 * start time collides in the stamp's 48 bits matches, a 2^-48 chance per reuse. Each costs one slot's capacity
 * until that process exits, and the pass falls back to a fresh snapshot; none can let two processes hold one slot.
 *
 * The git half — moving a held slot's tree to a snapshot — is `./snapshotPool.ts`.
 *
 * Removing a pool takes the same leases: {@link claimSlotForRemoval} claims one exact slot at a time and never one
 * whose holder is not PROVEN dead, and `./snapshotPoolReclaim.ts` holds every slot before anything goes.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { processStartOf } from "../talk/relayLease.js";
import { SNAPSHOT_POOL_SLOTS, SNAPSHOT_SLOT_MARKER_PREFIX } from "../worktree/snapshotPoolPath.js";

/** The marker of a slot nobody holds. */
const FREE_MARKER = `${SNAPSHOT_SLOT_MARKER_PREFIX}free`;

/** A held slot's marker: the holder's pid, its start-time stamp, then a lease id no other holder will reuse. */
const BUSY_MARKER =
  /^state\.busy\.(\d+)\.([0-9a-f]{12})\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A fresh busy marker for a lease held by `pid`, stamped with that process's start time.
 *
 * @param pid the holder's process id — this process's own, outside a test
 * @returns the marker name, or `undefined` when `ps` cannot stamp the process
 */
export function busyMarkerFor({ pid }: { pid: number }): string | undefined {
  const stamp = processStartStamp({ pid });
  if (stamp === undefined) {
    return undefined;
  }
  return busyMarkerName({ pid, stamp });
}

/** A busy marker from a stamp already read, under a fresh lease id. */
function busyMarkerName({ pid, stamp }: { pid: number; stamp: string }): string {
  return `${SNAPSHOT_SLOT_MARKER_PREFIX}busy.${String(pid)}.${stamp}.${randomUUID()}`;
}

/** A slot this process holds the lease on. */
export interface HeldSlot {
  /** The slot directory, `slot-<k>`. */
  readonly slot: string;
  /** The registered worktree inside it. */
  readonly tree: string;
  /** This lease's own busy marker name — the exact name release renames back. */
  readonly busyMarker: string;
}

/**
 * Take the lease on one slot: a free one, a dead holder's, or a newly minted one — whichever comes first.
 *
 * Every contention errno (`ENOENT`, `EEXIST`, `ENOTEMPTY`) means another process won that slot, so the scan
 * moves on.
 *
 * @param poolRoot one repository's pool directory
 * @returns the held slot
 */
export function claimSlot({ poolRoot }: { poolRoot: string }): HeldSlot {
  const stamp = processStartStamp({ pid: process.pid });
  if (stamp === undefined) {
    throw new Error("ps could not report this process's start time, so no lease it took could ever be reaped");
  }
  for (let index = 0; index < SNAPSHOT_POOL_SLOTS; index += 1) {
    const slot = join(poolRoot, `slot-${String(index)}`);
    const busyMarker = busyMarkerName({ pid: process.pid, stamp });
    const held = { busyMarker, slot, tree: join(slot, "tree") };
    const entries = readSlot({ slot });
    if (entries === undefined) {
      if (mintSlot({ busyMarker, poolRoot, slot })) {
        return held;
      }
      continue;
    }
    const markers = entries.filter((entry) => entry.startsWith(SNAPSHOT_SLOT_MARKER_PREFIX));
    if (markers.length !== 1) {
      continue;
    }
    const marker = markers[0]!;
    const claimable = marker === FREE_MARKER || isDeadLease({ marker });
    if (claimable && renameWon({ from: join(slot, marker), to: join(slot, busyMarker) })) {
      return held;
    }
  }
  throw new Error(`every one of the ${String(SNAPSHOT_POOL_SLOTS)} snapshot slots in ${poolRoot} is leased`);
}

/**
 * Return the lease: this exact busy marker back to free. Never throws — the verdict already exists.
 *
 * @param held the slot whose lease to return
 */
export function releaseHeldSlot({ held }: { held: HeldSlot }): void {
  try {
    renameSync(join(held.slot, held.busyMarker), join(held.slot, FREE_MARKER));
  } catch {
    // The marker is gone only if the slot was discarded. A leftover busy marker is reaped once this pid exits.
  }
}

/** Why a slot cannot be claimed for removal. Each one leaves the slot exactly as it was found. */
export type RemovalBlock = "live-holder" | "unknown-marker" | "contention" | "unreadable" | "unstampable";

/** What one slot's directory says about removing it, before anything is renamed. */
export type RemovalSlotState =
  | { readonly kind: "absent" }
  | { readonly kind: "claimable"; readonly marker: string }
  | { readonly kind: "blocked"; readonly reason: RemovalBlock };

/**
 * Decide whether a slot may be claimed for removal, from its directory entries alone — pure, so every arm is a
 * unit test. FAIL-CLOSED: only `state.free`, or a busy marker the holder test proves dead, is claimable. A live
 * holder, one whose death cannot be proven, and any slot not reading as exactly one known marker all block.
 *
 * @param entries the slot directory's entries, or `undefined` when the slot does not exist
 * @param isDead whether a busy marker's holder is PROVEN dead; production passes the lease's own test
 * @returns absent, claimable with the marker to rename, or blocked with why
 */
export function classifySlotForRemoval({
  entries,
  isDead,
}: {
  entries: readonly string[] | undefined;
  isDead: (args: { marker: string }) => boolean;
}): RemovalSlotState {
  if (entries === undefined) {
    return { kind: "absent" };
  }
  const markers = entries.filter((entry) => entry.startsWith(SNAPSHOT_SLOT_MARKER_PREFIX));
  if (markers.length !== 1) {
    return { kind: "blocked", reason: "unknown-marker" };
  }
  const marker = markers[0]!;
  if (marker === FREE_MARKER) {
    return { kind: "claimable", marker };
  }
  if (!BUSY_MARKER.test(marker)) {
    return { kind: "blocked", reason: "unknown-marker" };
  }
  if (isDead({ marker })) {
    return { kind: "claimable", marker };
  }
  return { kind: "blocked", reason: "live-holder" };
}

/** One exact slot claimed for removal, or why it was left alone. */
export type RemovalSlotClaim =
  | {
      readonly kind: "claimed";
      readonly held: HeldSlot;
      /** False when the slot was absent and this claim minted a placeholder holding only its marker. */
      readonly existed: boolean;
    }
  | { readonly kind: "blocked"; readonly slot: string; readonly reason: RemovalBlock };

/**
 * Claim exactly `slot-<index>` so it can be removed: never a scan for another index, and never a live holder's.
 *
 * An absent index is minted as a placeholder holding this process's busy marker, so no acquirer can fill that
 * gap while a removal takes the rest of the pool. A rename another process wins is `contention`, and the winner
 * is never presumed dead. A failure to read or rename is `unreadable`. Nothing here throws.
 *
 * @param poolRoot the pool directory this run's own acquire returned
 * @param index which slot, `0` up to the pool's slot count
 * @returns the held slot, or why it was left exactly as found
 */
export function claimSlotForRemoval({ poolRoot, index }: { poolRoot: string; index: number }): RemovalSlotClaim {
  const slot = join(poolRoot, `slot-${String(index)}`);
  const stamp = processStartStamp({ pid: process.pid });
  if (stamp === undefined) {
    return { kind: "blocked", reason: "unstampable", slot };
  }
  const busyMarker = busyMarkerName({ pid: process.pid, stamp });
  const held = { busyMarker, slot, tree: join(slot, "tree") };
  try {
    const state = classifySlotForRemoval({ entries: readSlot({ slot }), isDead: isDeadLease });
    if (state.kind === "blocked") {
      return { kind: "blocked", reason: state.reason, slot };
    }
    if (state.kind === "absent") {
      if (mintSlot({ busyMarker, poolRoot, slot })) {
        return { existed: false, held, kind: "claimed" };
      }
      return { kind: "blocked", reason: "contention", slot };
    }
    if (renameWon({ from: join(slot, state.marker), to: join(slot, busyMarker) })) {
      return { existed: true, held, kind: "claimed" };
    }
    return { kind: "blocked", reason: "contention", slot };
  } catch {
    // An unreadable slot, or a rename failing for something other than contention: left alone, as found.
    return { kind: "blocked", reason: "unreadable", slot };
  }
}

/**
 * Whether a thrown value is a Node system error carrying one of these errno codes.
 *
 * @param codes the errno codes that count
 * @param error whatever was thrown
 * @returns true when the error is one of them
 */
export function isErrno({ codes, error }: { codes: readonly string[]; error: unknown }): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}

/** The slot directory's entries, or `undefined` when it does not exist yet. */
function readSlot({ slot }: { slot: string }): readonly string[] | undefined {
  try {
    return readdirSync(slot);
  } catch (error) {
    if (isErrno({ codes: ["ENOENT"], error })) {
      return undefined;
    }
    throw error;
  }
}

/** Mint a slot holding this lease's busy marker, renamed into place whole. False when another process won. */
function mintSlot({ busyMarker, poolRoot, slot }: { busyMarker: string; poolRoot: string; slot: string }): boolean {
  const minting = mkdtempSync(join(poolRoot, ".mint-"));
  writeFileSync(join(minting, busyMarker), "");
  if (renameWon({ from: minting, to: slot })) {
    return true;
  }
  rmSync(minting, { force: true, recursive: true });
  return false;
}

/** Rename, reporting whether this process won it; any contention errno is a loss, anything else a failure. */
function renameWon({ from, to }: { from: string; to: string }): boolean {
  try {
    renameSync(from, to);
    return true;
  } catch (error) {
    if (isErrno({ codes: ["ENOENT", "EEXIST", "ENOTEMPTY"], error })) {
      return false;
    }
    throw error;
  }
}

/**
 * Whether a marker is a busy lease whose holder has exited: its pid not running, a zombie, or now another process's,
 * whose start stamp differs. A running pid `ps` could not stamp leaves the slot alone.
 */
function isDeadLease({ marker }: { marker: string }): boolean {
  const match = BUSY_MARKER.exec(marker);
  if (match === null) {
    return false;
  }
  const holder = processStartOf({ pid: Number(match[1]) });
  if (!holder.running) {
    return true;
  }
  if (holder.start === undefined) {
    return false;
  }
  return startStamp({ start: holder.start }) !== match[2];
}

/** A process's start stamp as a marker carries it, or `undefined` when it is not running or `ps` gave none. */
function processStartStamp({ pid }: { pid: number }): string | undefined {
  const { running, start } = processStartOf({ pid });
  if (!running || start === undefined) {
    return undefined;
  }
  return startStamp({ start });
}

/** A 12-hex digest of a start time as `ps` prints it, which keeps the marker a plain filename. */
function startStamp({ start }: { start: string }): string {
  return createHash("sha256").update(start).digest("hex").slice(0, 12);
}
