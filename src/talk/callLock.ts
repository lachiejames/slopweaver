/**
 * A file's write lock: `<file>.lock` beside it, naming its holder. `./callStore.ts` holds one on a call file so two
 * `talk transcript` appends of the same call never interleave, and `./cardLandingStore.ts` one on the landing ledger
 * so two landings never decide off the same read.
 */
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { unstampedLeaseRefusal } from "../admit/lockHolder.js";
import { DEFAULT_STALE_AFTER_MS } from "../admit/operationLockHeld.js";
import { isRecord } from "../lib/parsers.js";
import { sleepSync } from "../lib/sleepSync.js";

import { holderLine, holderOf, holderRunning, type StartOf } from "./relayLease.js";

/** How long an append waits for another writer of the same call before it gives up and says so. */
export const CALL_LOCK_WAIT_MS = 10_000;

/** How long a waiting append pauses between tries. */
const CALL_LOCK_POLL_MS = 20;

/**
 * Take a call file's append lock, `<callId>.jsonl.lock` beside it — or throw once a live writer has held it past
 * the wait. The route spawns one `talk transcript` per batch, and a keepalive flush can race one in flight, so two
 * appends of the same call can run at once; a short write looped to completion would then land another batch inside
 * one of its lines. The name does not end `.jsonl`, so no reader of the calls directory
 * takes it for a call.
 *
 * The lock names its holder — a pid and that process's start time — written in full beside it and placed by `link`,
 * so it is never half there. It is taken over only when that holder is gone — not running, a zombie, or its pid since
 * handed on (`./relayLease.ts`'s `holderRunning`, the one liveness check every lock here reads) — and never by age: a
 * writer paused past any age is still mid-batch, and a successor appending then would land inside it. Because nothing ages a stamped holder out, a writer `ps` cannot stamp is refused rather than placing
 * a pid-only lock (`../admit/lockHolder.ts`'s `unstampedLeaseRefusal`), and a pid-only lock an older writer left
 * ages out on the ordinary window (`abandonedRecord`), its pid alone being no proof the writer is still the one that
 * placed it. A lock naming no holder — a link at the path included — is not this module's and is never taken over,
 * so the ledger's lock refuses every landing until whatever put it there removes it, each landing saying it failed
 * and the words kept in the call file. Release removes the lock only while it is still the file this writer placed.
 * A takeover is one writer at a time: it holds `<lock>.takeover`, placed the same way, and re-reads the holder under
 * it, so two writers finding the same dead holder never both remove the lock — the second would remove the first's
 * live one. Residue, named: a guard whose own holder is gone is cleared by whoever finds it, which
 * needs a writer killed while taking over a lock whose holder was itself killed. Every removal, release included,
 * re-reads the file it placed or judged — same device, inode, mtime and line — just before unlinking it, so a guard
 * or lock placed since is kept; POSIX has no remove-if-unchanged, so the instant between that re-read and the unlink
 * stays open, and only two writers clearing the same dead guard at once can meet in it.
 *
 * @param path the call file
 * @param waitMs how long to wait for another writer
 * @param pid the pid this writer names itself by
 * @param startOf a pid's current start time — injected so a dead or recycled holder is a fixture, not a process
 * @param now the deadline's clock, injected so a test can tick it; the deadline is read only before a sleep, so a
 * call always tries once and always tries again after a takeover, whatever the wait — a `waitMs: 0` read on a free
 * lock once refused it when the millisecond ticked before the first try (CI run 40310687910, unit-5)
 * @returns what releases the lock
 */
export function holdCallLock({
  path,
  waitMs,
  pid,
  startOf,
  now = Date.now,
}: {
  path: string;
  waitMs: number;
  pid: number;
  startOf: StartOf;
  now?: () => number;
}): () => void {
  const lock = `${path}.lock`;
  const start = stampOf({ pid, startOf });
  const unstamped = unstampedLeaseRefusal({ path: lock, staleAfterMs: Number.POSITIVE_INFINITY, start });
  if (unstamped !== undefined) {
    throw new Error(unstamped);
  }
  const line = holderLine({ pid, start });
  const staged = `${lock}.${String(pid)}.tmp`;
  // Release removes only the very file this writer placed, never one a later hold re-placed under the same holder
  // line after this one's was removed out from under it.
  const releaseOf =
    (placed: LockRecord): (() => void) =>
    () => {
      removeIfUnchanged({ judged: placed, lock });
    };
  const deadline = now() + waitMs;
  for (;;) {
    const placed = placeCallLock({ line, lock, staged });
    if (placed !== undefined) {
      return releaseOf(placed);
    }
    if (abandonedRecord({ lock, nowMs: now(), startOf }) !== undefined && takeOver({ line, lock, now, pid, startOf })) {
      const retaken = placeCallLock({ line, lock, staged });
      if (retaken !== undefined) {
        return releaseOf(retaken);
      }
    }
    if (now() > deadline) {
      throw new Error(`a live writer has held ${lock} for over ${String(waitMs)} ms`);
    }
    sleepSync({ ms: CALL_LOCK_POLL_MS });
  }
}

/**
 * This writer's start stamp, or `undefined` when it has none. A start is a stamp only when the line it writes reads
 * back, trimmed, as that very start: `-` is the line's own no-stamp mark, and an empty one, one ending in whitespace or one
 * holding a newline would not survive the read, nor one that is not well-formed UTF-16 survive the write, so each is
 * no stamp at all. One that does survive is a stamp whatever its shape, since the holder it
 * names is compared against the same read.
 *
 * @param pid the pid this writer names itself by
 * @returns the start the holder line carries, or `undefined` when `ps` gave none that survives the read-back
 */
function stampOf({ pid, startOf }: { pid: number; startOf: StartOf }): string | undefined {
  const read = startOf(pid).start;
  // A lone surrogate survives the in-memory read-back but not the UTF-8 write, which turns it into U+FFFD: the line
  // on disk would then name a start no read of this process ever returns.
  if (read === undefined || !read.isWellFormed()) {
    return undefined;
  }
  const readBack = holderOf({ text: holderLine({ pid, start: read }).trim() });
  if (readBack?.start !== read) {
    return undefined;
  }
  return read;
}

/**
 * Remove a lock whose holder is gone, holding `<lock>.takeover` while its holder is read again — so of two writers
 * that found it abandoned, only one removes it, and never after the other placed its own.
 *
 * @param line this writer's holder line, which the guard names
 * @param now the clock an unstamped holder's age is read against, at each judgement
 * @returns whether this writer held the guard: `false` while another writer is taking the lock over
 */
function takeOver({
  line,
  lock,
  now,
  pid,
  startOf,
}: {
  line: string;
  lock: string;
  now: () => number;
  pid: number;
  startOf: StartOf;
}): boolean {
  const guard = `${lock}.takeover`;
  const held = placeCallLock({ line, lock: guard, staged: `${guard}.${String(pid)}.tmp` });
  if (held === undefined) {
    removeIfUnchanged({ judged: abandonedRecord({ lock: guard, nowMs: now(), startOf }), lock: guard });
    return false;
  }
  try {
    removeIfUnchanged({ judged: abandonedRecord({ lock, nowMs: now(), startOf }), lock });
    return true;
  } finally {
    removeIfUnchanged({ judged: held, lock: guard });
  }
}

/**
 * One lock file, as a writer placed it or read it through a single descriptor: the device and inode it is, the holder
 * line it carries and when it was written. Device, inode and mtime together name the file — an inode number is unique
 * only per device, and a freed one can be handed straight to the next file on Linux, but that file is
 * written later. All three are read as bigints, since a 64-bit inode number past 2^53 rounds as a JS number. Residue,
 * named: a live stamped lock is never removed by this protocol, so a file can only take its place once something
 * OUTSIDE it unlinked the lock — and then, on a reused inode with an mtime set back (`utimensat`) or written in the
 * same coarse tick, the newcomer reads as this file. That actor already removes the lock outright; no check here
 * could hold it back.
 */
interface LockRecord {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly line: string;
  readonly mtimeNs: bigint;
}

/**
 * Place the lock if no writer holds it: its holder line written in full beside it, then linked into place.
 *
 * @param line the holder the lock names
 * @param staged where the line is written before the link
 * @returns the file this writer placed, or `undefined` when another already holds it
 */
function placeCallLock({ line, lock, staged }: { line: string; lock: string; staged: string }): LockRecord | undefined {
  try {
    // A name already at the staging path is unlinked, never written through: a planted hard link or symlink there would
    // otherwise truncate whatever file it points at, another call's journal perhaps. The write
    // then creates the name exclusively.
    rmSync(staged, { force: true });
    writeFileSync(staged, `${line}\n`, { flag: "wx", mode: 0o600 });
    // The link shares the staged file's inode and mtime, which is how release later knows the lock is still this one.
    const { dev, ino, mtimeNs } = lstatSync(staged, { bigint: true });
    linkSync(staged, lock);
    return { dev, ino, line, mtimeNs };
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "EEXIST") {
      return undefined;
    }
    throw cause;
  } finally {
    rmSync(staged, { force: true });
  }
}

/**
 * A lock file read through one descriptor, so its line, inode and mtime all describe the same file — or `undefined`
 * once it is gone or cannot be read; a lock released between the try and this read is simply tried again.
 *
 * @returns the record, its line trimmed
 */
function lockRecord({ lock }: { lock: string }): LockRecord | undefined {
  try {
    // Never through a symlink: a link at the path is not this module's, and read through it, it would carry the
    // identity of the file it names while the unlink removed the link itself.
    const fd = openSync(lock, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const { dev, ino, mtimeNs } = fstatSync(fd, { bigint: true });
      return { dev, ino, line: readFileSync(fd, "utf8").trim(), mtimeNs };
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/**
 * The lock record judged abandoned, so it may be taken over — `undefined` while its holder may still hold it.
 *
 * A holder that carries its start stamp is judged by liveness alone, at any age. One that carries none (`<pid> -`)
 * was written before a writer had to stamp itself, and its pid alone may since be another process's: a recycled pid
 * would hold it for as long as that process lived. So it ages out on the operation lock's ordinary window
 * (`../admit/operationLockHeld.ts` `heldReason`), the mtime of the file it was read from being the only age it has.
 *
 * @param nowMs the instant an unstamped holder's age is judged at
 * @returns the record, only when it names a holder no longer running as the process that placed it
 */
function abandonedRecord({
  lock,
  nowMs,
  startOf,
}: {
  lock: string;
  nowMs: number;
  startOf: StartOf;
}): LockRecord | undefined {
  const record = lockRecord({ lock });
  if (record === undefined) {
    return undefined;
  }
  const holder = holderOf({ text: record.line });
  if (holder === undefined) {
    return undefined;
  }
  if (!holderRunning({ holder, startOf })) {
    return record;
  }
  if (holder.start === undefined && nowMs - Number(record.mtimeNs / 1_000_000n) > DEFAULT_STALE_AFTER_MS) {
    return record;
  }
  return undefined;
}

/**
 * Remove a lock only while it is still the very file placed or judged abandoned — same inode, mtime and holder line —
 * so a lock or guard another writer, or a later hold of this one, placed since is kept.
 *
 * @param judged the file this writer placed or judged abandoned, or `undefined` when there is none to remove
 */
function removeIfUnchanged({ judged, lock }: { judged: LockRecord | undefined; lock: string }): void {
  if (judged === undefined) {
    return;
  }
  const current = lockRecord({ lock });
  const same =
    current !== undefined &&
    current.dev === judged.dev &&
    current.ino === judged.ino &&
    current.mtimeNs === judged.mtimeNs &&
    current.line === judged.line;
  if (same) {
    rmSync(lock, { force: true });
  }
}
