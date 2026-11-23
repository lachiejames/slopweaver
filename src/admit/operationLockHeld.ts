/**
 * The one judgement `./operationLockTakeover.ts` makes about a holder it found in the way: stale and recoverable, or
 * still held — and when held, whether that is CONTENTION a rerun waits out or a REFUSAL no rerun clears.
 *
 * Split out of the lock module along that seam: everything here reads one record and the clock and answers,
 * while the module that imports it owns every filesystem move. The typed refusal lives here because this is
 * where the two kinds are told apart; `atlas vanta sync` turns `LOCK_CONTENDED` into its exit 4 and must never
 * do that for `LOCK_REFUSED`.
 */
import { errorMessage } from "../lib/errorMessage.js";
import { holderIsAlive } from "./lockHolder.js";

/** What one lock record carries. */
export interface LockContents {
  readonly pid: number;
  readonly acquiredAtIso: string;
  /**
   * When the holder's process started, as `ps` prints it (`./lockHolder.ts`), or absent when
   * `ps` could not say or the record predates it. With it, a pid handed on to another process reads as dead.
   */
  readonly start?: string | undefined;
}

/** How long a lock may sit unreleased before a later caller may take it over — long enough for a real
 * multi-entry rebase chain, short enough that a crashed process does not wedge the tool for long. */
export const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

/** A LIVE holder had the lock within its threshold, so running again once it finishes is correct. */
interface OperationLockContendedError {
  readonly code: "LOCK_CONTENDED";
  readonly message: string;
}

/**
 * Everything else that leaves the lock untaken — a record that cannot be read or compared, an install that
 * failed, a lease this process may not take. None of these is waited out by running again unchanged.
 */
interface OperationLockRefusedError {
  readonly code: "LOCK_REFUSED";
  readonly message: string;
}

/** Why one acquisition does not hold the lock, typed for a caller whose exit code depends on which. */
export type OperationLockAcquireError = OperationLockContendedError | OperationLockRefusedError;

/** How to raise one — the factory the real code calls. */
export const OperationLockAcquireErrors = {
  contended: ({ message }: { message: string }): OperationLockContendedError => ({ code: "LOCK_CONTENDED", message }),
  refused: ({ message }: { message: string }): OperationLockRefusedError => ({ code: "LOCK_REFUSED", message }),
  /** A filesystem fault while staging the attempt: an unwritable home, or a file where the lock directory belongs. */
  stagingFailed: ({ error, path }: { error: unknown; path: string }): OperationLockRefusedError => ({
    code: "LOCK_REFUSED",
    message: `could not stage the lock at ${path}: ${errorMessage({ error })}`,
  }),
} as const;

/**
 * The refusal for a holder that is still live and under the threshold, or undefined when it is stale.
 *
 * A dead holder is stale AT ONCE, whatever its age. The threshold exists to recover a lock whose owner
 * vanished without releasing it, and waiting out fifteen minutes to do that for a process the kernel
 * already says is gone is a refusal with no one on the other side of it. Measured: an
 * interrupted `onepassword sync` left this lock behind and every retry for the next quarter of an hour
 * was refused by a pid that no longer existed.
 *
 * The refusal names BOTH checks it failed, not just the age. Naming only the threshold reads as "this
 * door waits out fifteen minutes for a process that may be long gone", which is what a reader concludes
 * when the liveness check is invisible — measured: a session read this line across 52 minutes
 * of contention, checked `ps` on two of the holders AFTER they had finished, found them gone, and filed a
 * fleet finding asking for the liveness check this line had already run. Stated in the PAST TENSE against
 * the instant checked — see `./operationLock.ts`'s header for the measurement.
 *
 * **A comparison that cannot be made FAILS CLOSED against a live holder, and that is one gate over every
 * input rather than a check per input.** Three values reach this decision from outside — the caller's
 * `nowIso`, its `staleAfterMs`, and an `acquiredAtIso` some other writer left — and any of them can be
 * unusable: `Date.parse` answers `NaN` for an unreadable instant, and a threshold arrives as whatever
 * number a caller passed. `NaN` loses EVERY comparison, so written as the single `ageMs <= staleAfterMs &&`
 * test this module used to carry, an unusable value reads as "not held" and a live holder milliseconds old
 * gets its lock taken away. That schedule was built from two different inputs
 * — which is why the answer is a comparability gate over the whole
 * decision and not a guard on the input that was caught. Staleness is claimed ONLY from a comparison that
 * was really made; otherwise the liveness check alone decides, so a holder the kernel still answers for is
 * refused, saying which value could not be read, and one the kernel says is gone is recovered exactly as it
 * would be at any age.
 *
 * **`Infinity` is a DECLARATION, not an unusable input, and it gets its own refusal.** A caller that never
 * wants a live holder aged out passes positive infinity — `src/browser/relayLease.ts`'s
 * `RELAY_LEASE_STALE_AFTER_MS`, whose walk of thirty pages runs past any threshold worth setting — and
 * `ageMs > Infinity` is a comparison that really is made and answers "not stale" at every age, so the gate
 * above admits it and the liveness path is untouched. Only `NaN` and a negative infinity remain unusable.
 * MEASURED: two `slopweaver browser shot` walks at once told the loser *"the stale threshold it
 * was given, Infinity, is not a finite number of milliseconds"* — the arbitration mechanism accusing its own
 * lock of being misconfigured while working exactly as designed. That is the genre of line a session goes
 * and investigates: the same message cost one session 52 minutes and produced the fleet row
 * `nothing-arbitrates-the-playwright-relay-and-the-loser`. Reproduce it with two concurrent
 * `slopweaver browser shot --url <a> --raw --settle 8000` and read the loser's stderr.
 *
 * @param existing the record the occupied lock path holds
 * @param nowIso the instant of this attempt
 * @param staleAfterMs the caller's threshold, or positive infinity for a lease never aged out while its holder lives
 * @returns undefined when the holder is stale, else `LOCK_CONTENDED` for a live holder within its threshold
 *   and `LOCK_REFUSED` when the age could not be compared at all
 */
export function heldReason({
  existing,
  nowIso,
  staleAfterMs: declared,
}: {
  existing: LockContents;
  nowIso: string;
  staleAfterMs: number;
}): OperationLockAcquireError | undefined {
  // Never-stale trusts the holder's identity; a record with no start stamp (only one written before the field: an
  // unstamped process is refused this lease, `./lockHolder.ts`) has a pid another process may have since. It ages out
  // on the ordinary window, as every record once did; else a recycled pid wedges the lease for good.
  const unidentified = declared === Number.POSITIVE_INFINITY && existing.start === undefined;
  const staleAfterMs = unidentified ? DEFAULT_STALE_AFTER_MS : declared;
  const ageMs = Date.parse(nowIso) - Date.parse(existing.acquiredAtIso);
  const neverStale = staleAfterMs === Number.POSITIVE_INFINITY;
  const comparable = Number.isFinite(ageMs) && (Number.isFinite(staleAfterMs) || neverStale);
  if (comparable && ageMs > staleAfterMs) {
    return undefined;
  }
  if (!holderIsAlive({ pid: existing.pid, start: existing.start })) {
    return undefined;
  }
  // REFUSED, not contended: nothing says this state ends, so a caller that defers on contention must not wait on it.
  if (!comparable) {
    return OperationLockAcquireErrors.refused({
      message: `held by pid ${String(existing.pid)} since ${existing.acquiredAtIso}, and its age could not be compared with the stale threshold because ${unreadableValue({ existing, nowIso, staleAfterMs })} — the holder answered signal 0, so this is refused rather than taken over`,
    });
  }
  if (neverStale) {
    return OperationLockAcquireErrors.contended({
      message: `held by pid ${String(existing.pid)} since ${existing.acquiredAtIso} (${String(ageMs)}ms old, under a lease declared never to go stale while its holder lives, and the holder answered signal 0 — it was ALIVE when checked at ${nowIso}, so this is contention rather than a lock left behind by a dead process; wait for the holder to finish)`,
    });
  }
  return OperationLockAcquireErrors.contended({
    message: `held by pid ${String(existing.pid)} since ${existing.acquiredAtIso} (${String(ageMs)}ms old, under the ${String(staleAfterMs)}ms stale threshold, and the holder answered signal 0 — it was ALIVE when checked at ${nowIso}, so this is contention rather than a lock left behind by a dead process)`,
  });
}

/**
 * Which of the three outside values made the age comparison impossible, named in the refusal — a reader
 * who is told only that it could not be compared cannot tell a bad argument from a corrupt record.
 *
 * The threshold arm reaches only `NaN` and a negative infinity: a POSITIVE infinity is a never-stale
 * declaration {@link heldReason} compares against like any other bound, so it never arrives here.
 *
 * @returns the clause naming the unusable value
 */
function unreadableValue({
  existing,
  nowIso,
  staleAfterMs,
}: {
  existing: LockContents;
  nowIso: string;
  staleAfterMs: number;
}): string {
  if (Number.isNaN(Date.parse(nowIso))) {
    return `the instant of this attempt, ${nowIso}, is not a readable instant`;
  }
  if (Number.isNaN(Date.parse(existing.acquiredAtIso))) {
    return `its own acquiredAtIso, ${existing.acquiredAtIso}, is not a readable instant`;
  }
  return `the stale threshold it was given, ${String(staleAfterMs)}, is neither a finite number of milliseconds nor the positive infinity that declares a lease never stale`;
}
