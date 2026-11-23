import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { type Pause, timerPause } from "../../../lib/coalescedRead";

describe("timerPause", () => {
  /** A timer pair that only records: each armed timer's handle and fire, and every handle cleared. */
  function recordingTimers(): {
    armed: { readonly handle: { readonly id: number }; readonly ms: number; readonly fire: () => void }[];
    cleared: { readonly id: number }[];
    pause: Pause;
  } {
    const armed: { readonly handle: { readonly id: number }; readonly ms: number; readonly fire: () => void }[] = [];
    const cleared: { readonly id: number }[] = [];
    const pause = timerPause<{ readonly id: number }>({
      clearTimer: ({ handle }) => {
        cleared.push(handle);
      },
      setTimer: ({ ms, fire }) => {
        const handle = { id: armed.length };
        armed.push({ fire, handle, ms });
        return handle;
      },
    });
    return { armed, cleared, pause };
  }

  it("clears exactly the timer it armed, once, when its signal aborts", async () => {
    const timers = recordingTimers();
    const control = new AbortController();
    const waited = timers.pause({ ms: 48_000, signal: control.signal });
    control.abort();
    await waited;

    expect(timers.armed.map((timer) => timer.ms)).toEqual([48_000]);
    expect(timers.cleared).toEqual([timers.armed[0].handle]);
    expect(timers.cleared[0]).toBe(timers.armed[0].handle);
  });

  it("resolves when its timer fires, clearing nothing and leaving no listener behind", async () => {
    const timers = recordingTimers();
    const control = new AbortController();
    const waited = timers.pause({ ms: 48_000, signal: control.signal });
    timers.armed[0].fire();
    await waited;

    expect(timers.cleared).toEqual([]);
    expect(getEventListeners(control.signal, "abort").length).toBe(0);
  });

  it("still clears its timer when the signal aborts while the timer is being armed", async () => {
    const control = new AbortController();
    const armed: { readonly id: number }[] = [];
    const cleared: { readonly id: number }[] = [];
    const pause = timerPause<{ readonly id: number }>({
      clearTimer: ({ handle }) => {
        cleared.push(handle);
      },
      setTimer: () => {
        const handle = { id: 0 };
        armed.push(handle);
        control.abort();
        return handle;
      },
    });
    await pause({ ms: 48_000, signal: control.signal });

    expect(cleared).toEqual(armed);
    expect(cleared[0]).toBe(armed[0]);
  });

  it("arms nothing for a signal that has already aborted", async () => {
    const timers = recordingTimers();
    const control = new AbortController();
    control.abort();
    await timers.pause({ ms: 48_000, signal: control.signal });

    expect(timers.armed).toEqual([]);
    expect(timers.cleared).toEqual([]);
  });
});
