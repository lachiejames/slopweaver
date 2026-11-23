/**
 * The repo's ONE synchronous sleep.
 *
 * `Atomics.wait` against a private buffer nothing can ever notify is the standard way to park a thread for
 * a fixed interval without burning it: the wait runs its timeout out and returns `timed-out`. Node exposes
 * no other synchronous pause — `setTimeout` needs an event loop turn the caller has not got, and a spin loop
 * on `Date.now()` holds the CPU for the whole interval.
 *
 * It lives here rather than beside its first caller because a second copy is how this repository has been
 * bitten before (four independent `tsToIso` copies, none of them wrong on its own, with no single function a
 * rule could name). Three callers want it for three reasons — a logger waiting on a full pipe, a store waiting
 * for another process to release a lock, and a browser lane that is synchronous by construction (`no-headless`
 * bans the asynchronous child-process capabilities it drives) — and no reason is another's.
 */

/** One shared cell for every sleep, so a caller in a loop does not allocate a buffer per pause. */
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

/**
 * Park the calling thread for `ms`, then return.
 *
 * Nothing ever notifies the cell, so this always runs the full interval: it is a PAUSE, never a wait on a
 * condition. A caller that is really waiting for something must re-check the condition itself after it
 * returns, which makes every use of this a bounded poll rather than a blocking wait.
 *
 * @param ms how long to park; a non-positive value returns immediately
 */
export function sleepSync({ ms }: { ms: number }): void {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(SLEEP_CELL, 0, 0, ms);
}
