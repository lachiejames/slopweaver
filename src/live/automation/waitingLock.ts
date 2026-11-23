/**
 * An operation lock that waits out a busy holder a bounded number of times — the one shape every recipe
 * store's read-modify-write takes.
 *
 * `acquireOperationLock` refuses immediately while another live holder has it, which is right for a
 * multi-minute git rewrite and wrong for a recipe store: a refused write there reads as "something else is
 * running this row" and skips a firing, or loses a hold. Every section waited on here is one file read and one
 * atomic write, so waiting is affordable. It was `./slotLedger.ts`'s own loop until the definition store
 * needed the same wait for a failure hold (`./failureHoldStore.ts`).
 */
import { sleepSync } from "#lib/sleepSync.js";

import { acquireOperationLock, type OperationLockResult } from "../../admit/operationLock.js";

/** How many times a busy lock is retried before the write is reported impossible. */
const MAX_LOCK_ATTEMPTS = 5;

/** The pause before retrying a busy lock, doubled each attempt. The section is one read and one write. */
const FIRST_LOCK_RETRY_MS = 5;

/** Ceiling on that pause, so five attempts span ~155ms rather than growing without bound. */
const MAX_LOCK_RETRY_MS = 80;

/**
 * Take one operation lock, waiting out a busy one a bounded number of times.
 *
 * @param home the state home the lock lives under
 * @param key the lock's name — one per store, whichever row a write is about
 * @param nowIso the instant the write is judged at, for the lock's own staleness check
 * @param staleAfterMs how old a live holder may be before it is taken over; absent keeps the lock's own
 *   default, and `Number.POSITIVE_INFINITY` declares a lease no live holder ever loses
 * @returns the held lock, or the last refusal after every attempt
 */
export function acquireWaitingLock({
  home,
  key,
  nowIso,
  staleAfterMs,
}: {
  readonly home: string;
  readonly key: string;
  readonly nowIso: string;
  readonly staleAfterMs?: number | undefined;
}): OperationLockResult {
  const attempt = (): OperationLockResult =>
    acquireOperationLock({ home, key, nowIso, ...(staleAfterMs === undefined ? {} : { staleAfterMs }) });
  let waitMs = FIRST_LOCK_RETRY_MS;
  let last = attempt();
  for (let round = 1; round < MAX_LOCK_ATTEMPTS && last.isErr(); round += 1) {
    sleepSync({ ms: waitMs });
    waitMs = Math.min(waitMs * 2, MAX_LOCK_RETRY_MS);
    last = attempt();
  }
  return last;
}
