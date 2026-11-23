/**
 * The one way `slopweaver profile set` writes the owner row: under the owner-written mark (`./ownerProfileWritten.ts`,
 * which carries why the mark and the row must move together), and under one lock in the account's own home.
 *
 * A module of its own so the lock stays out of the PreToolUse dispatcher's bundle: the first-boot read
 * (`./profileFirstBoot.ts`) needs only the mark's path, while this sequence is `profile set`'s alone.
 *
 * One writer at a time: a writer that lost the insert to one that found its marks already made retracted the only
 * evidence of the winner's row, so a second `profile set` is refused rather than interleaved.
 * And no retraction without proof: a write that failed or threw may still have committed (a lost acknowledgement), so
 * its marks go only once a fresh read of the store says no row exists.
 *
 * The lock is a LIVE-HOLDER lease: never aged out while its holder runs, taken over only once that process is gone. The
 * ordinary 15-minute expiry let `profile context` take the lock from a `profile set` still blocked in its insert,
 * retract its marks on an empty read, and the insert then commit with no mark anywhere.
 */
import type { Result } from "#lib/result.js";

import { markFirstBootSession } from "./firstBootSession.js";
import { acquireOperationLockDetailed } from "./operationLock.js";
import { markOwnerProfileWritten, ownerMarksNaming, retractOwnerProfileWritten } from "./ownerProfileWritten.js";

/** The lock key one owner-row write holds, in the account's own home. */
const OWNER_WRITE_LOCK_KEY = "owner-profile-write";

/** The owner-write lock, held for as long as its holder lives and no longer. */
function acquireOwnerWriteLock({
  lockHome,
  nowIso,
}: {
  lockHome: string;
  nowIso: string;
}): ReturnType<typeof acquireOperationLockDetailed> {
  return acquireOperationLockDetailed({
    home: lockHome,
    key: OWNER_WRITE_LOCK_KEY,
    nowIso,
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
}

/** What a re-read of the store says about the owner row after a write that did not answer success. */
export type OwnerRowState = "present" | "absent" | "unknown";

/**
 * What a write under the owner mark came to. `locked`: another writer holds the lock, or it could not be taken.
 * `refused`: a home could not take a mark. `attempted`: the write ran; `kept` names marks left behind although no row
 * was proven, either because the re-read could not say or because a retraction failed.
 */
export type OwnerMarkedWrite<T, E> =
  | { readonly kind: "locked"; readonly reason: string }
  | { readonly kind: "refused"; readonly failed: readonly string[]; readonly kept: readonly string[] }
  | { readonly kind: "attempted"; readonly result: Result<T, E>; readonly kept: readonly string[] };

/** After a write that did not land, retract this write's marks only when the store proves no row exists. */
async function settleFailedWrite({
  created,
  rowState,
  store,
}: {
  created: readonly string[];
  rowState: () => Promise<OwnerRowState>;
  store: string;
}): Promise<readonly string[]> {
  let state: OwnerRowState;
  try {
    state = await rowState();
  } catch {
    state = "unknown";
  }
  if (state === "present") {
    return [];
  }
  if (state === "absent") {
    return retractOwnerProfileWritten({ paths: created, store });
  }
  return created;
}

/**
 * Run the owner-row write under the mark, holding the owner-write lock throughout: mark every home first, refuse the
 * write when any home cannot take a mark, and when the write does not land, retract this write's marks only once
 * `rowState` proves no row exists.
 *
 * @param homes the writer's resolved home and the default homes
 * @param lockHome the home the lock lives in — the account's own, which every writer on this machine shares
 * @param nowIso the instant of the attempt, for the lock
 * @param store the fingerprint of the store the row is written to, which each mark holds
 * @param sessionIds the ids the writer's environment names its session by — the ones the door judges it by — each
 *   marked as a first-boot session first, so the session creating the profile is held for it until it loads it
 * @param write the owner-row write, run only once every home carries the mark
 * @param rowState a fresh read of whether the owner row exists, asked only after a write that did not land
 * @returns `locked`, `refused` with the homes that could not take a mark, or `attempted` with the write's own result
 */
export async function writeUnderOwnerMark<T, E>({
  homes,
  lockHome,
  nowIso,
  store,
  sessionIds,
  write,
  rowState,
}: {
  homes: readonly string[];
  lockHome: string;
  nowIso: string;
  store: string;
  sessionIds: readonly string[];
  write: () => Promise<Result<T, E>>;
  rowState: () => Promise<OwnerRowState>;
}): Promise<OwnerMarkedWrite<T, E>> {
  const lock = acquireOwnerWriteLock({ lockHome, nowIso });
  if (lock.isErr()) {
    return { kind: "locked", reason: lock.error.message };
  }
  try {
    // No configuration trace, so a refusal here leaves nothing to take back (`./firstBootSession.ts`).
    if (!sessionIds.every((sessionId) => markFirstBootSession({ homes, sessionId }))) {
      return { failed: [...new Set(homes)], kept: [], kind: "refused" };
    }
    const marked = markOwnerProfileWritten({ homes, store });
    if (marked.failed.length > 0) {
      return {
        failed: marked.failed,
        kept: retractOwnerProfileWritten({ paths: marked.created, store }),
        kind: "refused",
      };
    }
    let result: Result<T, E>;
    try {
      result = await write();
    } catch (cause: unknown) {
      await settleFailedWrite({ created: marked.created, rowState, store });
      throw cause;
    }
    const kept = result.isOk() ? [] : await settleFailedWrite({ created: marked.created, rowState, store });
    return { kept, kind: "attempted", result };
  } finally {
    lock.value.release();
  }
}

/**
 * Run a live profile load under the owner-write lock, and when it proves the store holds no owner row, retract every
 * owner-written mark naming that store. A `profile set` killed between its mark and its row runs no retraction of its
 * own, so without this its mark holds a fresh machine for a profile no store has, and the hold's own recovery verb —
 * `profile context` — could only load nothing. The lock is what makes the empty read proof: no
 * writer can mark, commit and release between the read and the retraction. When another writer holds it the load runs
 * unlocked and retracts nothing, since that writer settles its own marks.
 *
 * @param homes the resolved home and the default homes, the same set `profile set` marks
 * @param lockHome the account's own home, where every writer's lock lives
 * @param nowIso the instant, for the lock
 * @param load the live load
 * @param disproved the fingerprint of the store a load READ live and found holding no owner row, `undefined` when it
 *   found one or read none — taken from the load itself, never a second read of the selection, which can change between
 *   two reads
 * @returns what the load produced, the marks it retracted, and the ones it could not remove
 */
export async function settleOwnerMarks<L>({
  homes,
  lockHome,
  nowIso,
  load,
  disproved,
}: {
  homes: readonly string[];
  lockHome: string;
  nowIso: string;
  load: () => Promise<L>;
  disproved: (loaded: L) => string | undefined;
}): Promise<{ readonly loaded: L; readonly retracted: readonly string[]; readonly kept: readonly string[] }> {
  const lock = acquireOwnerWriteLock({ lockHome, nowIso });
  if (lock.isErr()) {
    return { kept: [], loaded: await load(), retracted: [] };
  }
  try {
    const loaded = await load();
    const store = disproved(loaded);
    if (store === undefined) {
      return { kept: [], loaded, retracted: [] };
    }
    const naming = ownerMarksNaming({ homes, store });
    const kept = retractOwnerProfileWritten({ paths: naming, store });
    return { kept, loaded, retracted: naming.filter((path) => !kept.includes(path)) };
  } finally {
    lock.value.release();
  }
}
