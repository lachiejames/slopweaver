/**
 * The chunking boundary that makes a wait longer than Node's own timer ceiling actually wait that long,
 * proven with a fake timer that resolves instantly — this file never waits a real millisecond, let alone the
 * real 25 days a production overflow case would otherwise need to observe.
 */
import { describe, expect, it } from "vitest";

import { absentAsNumber } from "#lib/absent.js";
import { MAX_TIMER_MS, type WaitSeams, waitChunked } from "../../../../live/listen/chunkedWait.js";

/**
 * A fake timer that fires the moment it is armed, advancing a simulated clock by exactly the requested
 * chunk size first — so the clock the fix checks always agrees with nominal chunk arithmetic here, and
 * every existing sum-of-chunks assertion stays true. {@link lateBy} overrides that advance for one
 * scenario: a chunk that fires having actually taken LONGER than requested, simulating a suspend/resume
 * spanning its boundary.
 */
function instantTimer({ lateByMs = {} }: { lateByMs?: Record<number, number> } = {}): {
  readonly requestedMs: number[];
  readonly seams: WaitSeams;
} {
  const requestedMs: number[] = [];
  let now = 0;
  const seams: WaitSeams = {
    clearTimer: () => undefined,
    nowMs: () => now,
    setTimer: ({ ms, onElapsed }) => {
      const index = requestedMs.length;
      requestedMs.push(ms);
      now += absentAsNumber({ value: lateByMs[index], whenAbsent: ms });
      onElapsed();
      return undefined;
    },
  };
  return { requestedMs, seams };
}

/** A timer that never fires on its own — only `signal` can end the wait. */
function neverFiringTimer(): { readonly cleared: unknown[]; readonly seams: WaitSeams } {
  const cleared: unknown[] = [];
  const seams: WaitSeams = {
    clearTimer: ({ handle }) => {
      cleared.push(handle);
    },
    nowMs: () => 0,
    setTimer: () => ({ id: "pending" }),
  };
  return { cleared, seams };
}

describe("waitChunked", () => {
  it("resolves elapsed after one chunk when the wait fits under the timer ceiling", async () => {
    const { requestedMs, seams } = instantTimer();

    const outcome = await waitChunked({ ms: 5_000, seams, signal: new AbortController().signal });

    expect(outcome).toBe("elapsed");
    expect(requestedMs).toEqual([5_000]);
  });

  /**
   * A review pass found that eliding the timer entirely for a zero-length wait changed observable
   * event-loop-ordering behavior for the pre-existing zero-delay reconnect backoff, which used a real
   * `setTimeout(resolve, 0)` (a timers-PHASE yield) before this file's chunking existed. A real, even
   * zero-length, timer is armed here for exactly that reason — byte-for-byte timing parity with that caller.
   */
  it("still arms one real, zero-length timer for a zero-length wait — never resolves via bare microtask alone", async () => {
    const { requestedMs, seams } = instantTimer();

    const outcome = await waitChunked({ ms: 0, seams, signal: new AbortController().signal });

    expect(outcome).toBe("elapsed");
    expect(requestedMs).toEqual([0]);
  });

  /**
   * MEASURED against this repo's own pinned Node binary: a `setTimeout` over `MAX_TIMER_MS` clamps to
   * near-zero instead of waiting the requested time. This is the fix — a month-long deadline must arm
   * several bounded chunks, never one oversized timer a real Node process would silently truncate.
   */
  it("re-arms in MAX_TIMER_MS-sized chunks for a delay beyond one timer's ceiling", async () => {
    const { requestedMs, seams } = instantTimer();
    const monthMs = 30 * 24 * 60 * 60 * 1000; // a real monthly recipe deadline's rough scale

    const outcome = await waitChunked({ ms: monthMs, seams, signal: new AbortController().signal });

    expect(outcome).toBe("elapsed");
    expect(requestedMs.every((requested) => requested <= MAX_TIMER_MS)).toBe(true);
    expect(requestedMs.reduce((sum, requested) => sum + requested, 0)).toBe(monthMs);
    expect(requestedMs.length).toBeGreaterThan(1);
  });

  /**
   * A review pass's counterexample: a process suspended for the whole first chunk (a laptop closed across
   * that boundary) means real time has already passed the absolute deadline by the time the timer fires on
   * resume. The FIX is that the second chunk is sized off the real clock rather than nominal arithmetic — so
   * here it is elided entirely, not merely shortened, because the overshoot already covers the whole delay.
   */
  it("elides the next chunk when a suspend/resume makes the first one fire after the deadline has already passed", async () => {
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    // The first chunk (MAX_TIMER_MS) is requested, but the fake clock jumps the FULL monthMs while it is
    // "pending" — simulating the process being suspended until past the original absolute deadline.
    const { requestedMs, seams } = instantTimer({ lateByMs: { 0: monthMs } });

    const outcome = await waitChunked({ ms: monthMs, seams, signal: new AbortController().signal });

    expect(outcome).toBe("elapsed");
    expect(requestedMs).toEqual([MAX_TIMER_MS]);
  });

  /** The same gap, in its ordinary (not fully-overshooting) form: the overshoot only shortens the next chunk. */
  it("shortens, rather than adds on top of, the next chunk when a chunk fires later than its nominal size", async () => {
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    const overshootMs = 5 * 24 * 60 * 60 * 1000; // 5 days later than the first chunk's own nominal size
    const { requestedMs, seams } = instantTimer({ lateByMs: { 0: MAX_TIMER_MS + overshootMs } });

    const outcome = await waitChunked({ ms: monthMs, seams, signal: new AbortController().signal });

    expect(outcome).toBe("elapsed");
    expect(requestedMs).toEqual([MAX_TIMER_MS, monthMs - MAX_TIMER_MS - overshootMs]);
  });

  it("cancels before arming any timer when the signal is already aborted", async () => {
    const { requestedMs, seams } = instantTimer();
    const controller = new AbortController();
    controller.abort();

    const outcome = await waitChunked({ ms: 10_000, seams, signal: controller.signal });

    expect(outcome).toBe("cancelled");
    expect(requestedMs).toEqual([]);
  });

  it("cancels a pending chunk, clearing its timer, instead of waiting for it to elapse", async () => {
    const { cleared, seams } = neverFiringTimer();
    const controller = new AbortController();

    const wait = waitChunked({ ms: 10_000, seams, signal: controller.signal });
    controller.abort();
    const outcome = await wait;

    expect(outcome).toBe("cancelled");
    expect(cleared.length).toBe(1);
  });

  it("does not arm a second chunk once cancelled mid-wait", async () => {
    let calls = 0;
    let now = 0;
    const seams: WaitSeams = {
      clearTimer: () => undefined,
      nowMs: () => now,
      setTimer: ({ ms, onElapsed }) => {
        calls += 1;
        if (calls === 1) {
          // First chunk elapses normally; the wait must check the signal again BEFORE arming a second one.
          now += ms;
          onElapsed();
        }
        return undefined;
      },
    };
    const controller = new AbortController();
    controller.abort();

    await waitChunked({ ms: MAX_TIMER_MS + 10, seams, signal: controller.signal });

    expect(calls).toBe(0);
  });
});
