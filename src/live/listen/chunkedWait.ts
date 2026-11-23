/**
 * A cancellable wait that survives a delay longer than Node's own timer can express.
 *
 * MEASURED against this repo's pinned Node binary: `setTimeout` clamps any duration over
 * {@link MAX_TIMER_MS} (~24.85 days) to effectively nothing, firing almost immediately instead of waiting
 * the requested time. A monthly alert-recipe deadline would therefore wake instantly, recompute, and wake
 * again — a hot loop where a month-long wait was asked for. This file's whole job is to never hand a single
 * `setTimeout` a duration it cannot honour: it re-arms in bounded chunks until the full delay has actually
 * elapsed, or the signal cancels it early.
 *
 * The timer itself is injected ({@link WaitSeams}) rather than called directly, so the chunking boundary is
 * unit-testable with a fake that resolves instantly — this file's own tests never wait a real 25 days, or
 * even a real millisecond.
 */

/** Node's `setTimeout` ceiling: a 32-bit signed integer of milliseconds, ~24.85 days. Above this it clamps. */
export const MAX_TIMER_MS = 2_147_483_647;

/** The timer primitive this module chunks over. A plain seam, not a mock — see the module header. */
export interface WaitSeams {
  /** Start one bounded timer; returns a handle {@link clearTimer} can cancel. */
  readonly setTimer: (args: { ms: number; onElapsed: () => void }) => unknown;
  /** Cancel a timer this same call started, before it has fired. */
  readonly clearTimer: (args: { handle: unknown }) => void;
  /**
   * The current instant, consulted before EVERY chunk — never assumed from nominal chunk arithmetic.
   *
   * This is what makes a suspend/resume spanning a chunk boundary (the process, and so every timer, frozen
   * for longer than one nominal chunk — a laptop closed mid-wait) safe rather than silently late: a review
   * pass found that decrementing a nominal counter by each chunk's REQUESTED size, rather than rechecking
   * this clock, re-arms a full-length next chunk even after real time has already passed the deadline —
   * overshooting by however long the suspension lasted. Only reachable for a wait spanning more than one
   * {@link MAX_TIMER_MS} chunk (~24.85 days), since a shorter wait never re-arms at all.
   *
   * This function only ever measures a DURATION — the elapsed span since this call started — never an
   * external absolute instant, so wire it to a MONOTONIC clock (`performance.now()`, not `Date.now()`): a
   * later review pass found that a backward wall-clock adjustment (an NTP correction, a manual date change)
   * makes `Date.now()` here recompute a LARGER remaining time than actually elapsed, extending the wait
   * rather than shortening it.
   */
  readonly nowMs: () => number;
}

/**
 * Wait `ms`, re-arming in {@link MAX_TIMER_MS}-sized chunks so a duration beyond a single timer's ceiling is
 * honoured rather than clamped, checking `signal` between every chunk and cancelling promptly if it fires.
 *
 * The remaining delay is recomputed from {@link WaitSeams.nowMs} before every chunk, against the ABSOLUTE
 * instant this call started plus `ms` — never by decrementing a nominal counter — so a chunk that fires late
 * (a suspend/resume spanning its boundary) shortens or elides the next chunk instead of adding its own
 * nominal size on top of time that has already passed.
 *
 * @param ms the total delay, however large
 * @param seams the timer primitive to chunk over
 * @param signal cancels the wait early; checked before arming each chunk, and while one is pending
 * @returns `"elapsed"` once the full delay has passed, or `"cancelled"` if the signal fired first
 */
export async function waitChunked({
  ms,
  seams,
  signal,
}: {
  ms: number;
  seams: WaitSeams;
  signal: AbortSignal;
}): Promise<"elapsed" | "cancelled"> {
  const deadlineMs = seams.nowMs() + ms;
  // Whether a real timer has been armed at least once. A review pass found that eliding the arm entirely
  // for an already-elapsed `ms` (returning "elapsed" via plain microtask resolution) changed OBSERVABLE
  // event-loop-ordering behavior for a pre-existing caller: the reconnect loop's zero-delay backoff used a
  // real `setTimeout(resolve, 0)` before this file existed, which yields to the timers PHASE (letting
  // pending I/O callbacks run first) rather than resolving on the next microtask alone. The FIRST chunk is
  // therefore always armed for real, even at `ms: 0`, preserving that byte-for-byte timing; only a chunk
  // AFTER the first — reachable only via the multi-chunk suspend/resume recovery this file introduces, which
  // no pre-diff caller could ever reach — may be elided once it is already spent.
  let armedAny = false;
  for (;;) {
    if (signal.aborted) {
      return "cancelled";
    }
    const remaining = deadlineMs - seams.nowMs();
    if (remaining <= 0 && armedAny) {
      return "elapsed";
    }
    const chunkMs = Math.min(Math.max(remaining, 0), MAX_TIMER_MS);
    armedAny = true;
    const outcome = await new Promise<"elapsed" | "cancelled">((resolve) => {
      // `onAbort` is defined and registered BEFORE `setTimer` is called, but references the `handle` `const`
      // below it — safe only because `onAbort` cannot be INVOKED until a future "abort" event, which cannot
      // fire before this synchronous block finishes and `handle` is assigned. A fake timer (or an
      // already-elapsed real one) may call `onElapsed` synchronously instead; that path never touches
      // `handle` at all.
      const onAbort = (): void => {
        seams.clearTimer({ handle });
        resolve("cancelled");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const handle = seams.setTimer({
        ms: chunkMs,
        onElapsed: () => {
          signal.removeEventListener("abort", onAbort);
          resolve("elapsed");
        },
      });
    });
    if (outcome === "cancelled") {
      return "cancelled";
    }
    // No bookkeeping here on purpose: `remaining` is recomputed from `seams.nowMs()` at the top of the next
    // iteration, which is what makes a late-firing chunk (a suspend/resume spanning its boundary) shorten or
    // elide the next one instead of adding a full nominal chunk on top of time already passed — `armedAny`
    // is already `true` by the time we get here, so that elision is available from the second chunk on.
  }
}

/**
 * The real cancellable wait, on a MONOTONIC clock — what `listen` waits with.
 *
 * Deliberately not `Date.now()`: a review pass found that a backward wall-clock adjustment (an NTP
 * correction, a manual date change) while a chunk was pending would make {@link waitChunked}'s own recomputed
 * remaining time INCREASE rather than decrease, extending a bounded wait indefinitely. `waitChunked` only
 * ever measures a DURATION — it never compares against an external absolute instant — so a monotonic clock
 * is the correct primitive here regardless; only the ONE genuinely wall-clock-anchored check (`deadlineMs`
 * against `nowMs` in `runListenLoop`) needs `Date.now()`.
 *
 * @param ms how long to wait
 * @param signal the abort signal that cuts the wait short
 * @returns `"elapsed"` once the full delay passed, or `"cancelled"` if the signal fired first
 */
export async function liveChunkedWait({
  ms,
  signal,
}: {
  ms: number;
  signal: AbortSignal;
}): Promise<"elapsed" | "cancelled"> {
  return waitChunked({
    ms,
    seams: {
      clearTimer: ({ handle }) => {
        // `as`: this seam pair is defined together right here — `setTimer` below always returns exactly what
        // `setTimeout` did, so `handle` is sound even though the shared interface types it `unknown` to let
        // a test's fake timer return anything.
        // oxlint-disable-next-line no-unsafe-type-assertion
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
      nowMs: () => performance.now(),
      setTimer: ({ ms: chunkMs, onElapsed }) => setTimeout(onElapsed, chunkMs),
    },
    signal,
  });
}
