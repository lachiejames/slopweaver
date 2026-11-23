/*
 * Judging what occupies an operation lock's path once `./operationLock.ts`'s rename found it taken, and clearing
 * it when it is stale: a directory-shaped lock by its holder's own token file, a plain-file lock an older build
 * wrote by a hard link that re-reads it first. Why each step is shaped the way it is, and the one schedule it
 * does not close, is that module's header.
 */
import { linkSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import {
  heldReason,
  type LockContents,
  type OperationLockAcquireError,
  OperationLockAcquireErrors,
} from "./operationLockHeld.js";
import { type Holder, readLockState, readPlainFileLock } from "./operationLockState.js";

/**
 * Remove a holder judged stale: its token file, by the name only it carries, and then the directory only if
 * that left it empty. Every failure here means another process moved first, and the caller goes round again.
 */
function removeStaleHolder({ path, holder, candidate }: { path: string; holder: Holder; candidate: string }): void {
  if (holder.token === undefined) {
    removePlainFileLock({ judged: holder.contents, path, candidate });
    return;
  }
  try {
    unlinkSync(join(path, holder.token));
  } catch {
    // Already gone — another contender unlinked the same token, or the holder released late.
  }
  try {
    rmdirSync(path);
  } catch {
    // ENOTEMPTY: a fresh holder renamed onto the emptied directory and owns the lock now. ENOENT: gone.
  }
}

/**
 * Remove a stale plain-file lock without touching a directory seated in its place: `link` it into this
 * attempt's candidate (a directory cannot be hard-linked, so that fails on one), re-read the record through
 * the link, and unlink the path only when the record is still the one judged.
 */
function removePlainFileLock({
  judged,
  path,
  candidate,
}: {
  judged: LockContents;
  path: string;
  candidate: string;
}): void {
  const aside = join(candidate, "plain-file-lock");
  try {
    linkSync(path, aside);
  } catch {
    // ENOENT: another contender removed it. EPERM: a directory-shaped lock is there now.
    return;
  }
  const reread = readPlainFileLock({ path: aside });
  try {
    unlinkSync(aside);
  } catch {
    // The candidate directory is removed whole on the way out.
  }
  const same =
    reread.kind === "held" &&
    reread.holder.contents.pid === judged.pid &&
    reread.holder.contents.acquiredAtIso === judged.acquiredAtIso;
  if (!same) {
    return;
  }
  try {
    unlinkSync(path);
  } catch {
    // ENOENT: another contender got there first. EPERM/EISDIR: a directory is seated there now.
  }
}

/** One round's verdict on an occupied path: refuse with a reason, or go round again (a stale holder was
 * cleared, or the path was already changing under this attempt). */
type RoundOutcome =
  | { readonly kind: "refuse"; readonly reason: OperationLockAcquireError }
  | { readonly kind: "again"; readonly clearedPid: number | undefined };

/**
 * Judge what occupies the path after a rename found it occupied, and clear it when it is stale.
 *
 * @returns the reason to refuse, or the pid of the stale holder cleared (undefined when nothing was judged)
 */
export function judgeOccupant({
  path,
  candidate,
  nowIso,
  staleAfterMs,
}: {
  path: string;
  candidate: string;
  nowIso: string;
  staleAfterMs: number;
}): RoundOutcome {
  const state = readLockState({ path });
  if (state.kind === "unreadable") {
    return {
      kind: "refuse",
      reason: OperationLockAcquireErrors.refused({
        message: `a lock already exists at ${path} and could not be read to check its age`,
      }),
    };
  }
  if (state.kind !== "held") {
    return { clearedPid: undefined, kind: "again" };
  }
  const held = heldReason({ existing: state.holder.contents, nowIso, staleAfterMs });
  if (held !== undefined) {
    return { kind: "refuse", reason: held };
  }
  // Named whether this attempt or a peer did the unlinking: the caller's lock is reached through a takeover
  // of that pid either way, and a peer that cleared it and then lost the rename reports nothing.
  removeStaleHolder({ candidate, holder: state.holder, path });
  return { clearedPid: state.holder.contents.pid, kind: "again" };
}
