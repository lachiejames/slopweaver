import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { type CoalescedEntry, coalescedRead } from "../../../lib/coalescedRead";
import { handClock, handPause, heldRead, live } from "./harness";

describe("coalescedRead waiting for a slot", () => {
  const HOLD_MS = 15_000;
  const WAIT_MS = 10_000;

  it("lets a second channel wait for the first and then read, one child each, in order", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const two = heldRead({ answer: "C0TWO read", starts });
    const ask = ({ key, run }: { key: string; run: () => Promise<string> }): Promise<string> =>
      coalescedRead({
        busy: () => "busy",
        holdMs: HOLD_MS,
        key,
        limit: 1,
        now: clock.now,
        pause,
        reads,
        run,
        signal: live(),
        waitMs: WAIT_MS,
      });
    const first = ask({ key: "C0ONE", run: one.run });
    const second = ask({ key: "C0TWO", run: two.run });
    one.release();
    two.release();

    expect(await Promise.all([first, second])).toEqual(["C0ONE read", "C0TWO read"]);
    expect(starts).toEqual(["C0ONE read", "C0TWO read"]);
  });

  it("starts nothing for a caller whose request was already aborted, even with the slot free", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const control = new AbortController();
    control.abort();

    const answer = await coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0ONE",
      limit: 1,
      now: clock.now,
      pause,
      reads,
      run: one.run,
      signal: control.signal,
      waitMs: WAIT_MS,
    });

    expect(answer).toBe("busy");
    expect(starts).toEqual([]);
    expect([...reads.keys()]).toEqual([]);
  });

  it("answers busy for a waiter whose window closed, and starts nothing for it when the slot frees", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const two = heldRead({ answer: "C0TWO read", starts });
    const control = new AbortController();
    const running = coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0ONE",
      limit: 1,
      now: clock.now,
      pause,
      reads,
      run: one.run,
      signal: live(),
      waitMs: WAIT_MS,
    });
    const waiting = coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0TWO",
      limit: 1,
      now: clock.now,
      pause,
      reads,
      run: two.run,
      signal: control.signal,
      waitMs: WAIT_MS,
    });
    control.abort();
    one.release();

    expect(await waiting).toBe("busy");
    expect(await running).toBe("C0ONE read");
    expect(starts).toEqual(["C0ONE read"]);
  });

  it("never lets an expired waiter adopt a same-key read another waiter started after its bound passed", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const two = heldRead({ answer: "C0TWO read", starts });
    const ask = ({ key, run, waitMs }: { key: string; run: () => Promise<string>; waitMs: number }): Promise<string> =>
      coalescedRead({
        busy: () => "busy",
        holdMs: HOLD_MS,
        key,
        limit: 1,
        now: clock.now,
        pause,
        reads,
        run,
        signal: live(),
        waitMs,
      });
    const running = ask({ key: "C0ONE", run: one.run, waitMs: WAIT_MS });
    // The live waiter asks first, so its continuation runs first when the slot frees and it starts C0TWO; the expired
    // one wakes second and finds C0TWO already in the map.
    const liveWaiter = ask({ key: "C0TWO", run: two.run, waitMs: WAIT_MS });
    const expiredWaiter = ask({ key: "C0TWO", run: two.run, waitMs: 1000 });
    clock.advance({ ms: 5000 });
    one.release();
    two.release();

    expect(await Promise.all([running, liveWaiter, expiredWaiter])).toEqual(["C0ONE read", "C0TWO read", "busy"]);
    expect(starts).toEqual(["C0ONE read", "C0TWO read"]);
  });

  it("starts the read in the same turn it admits a live caller, so no abort can land between the two", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const control = new AbortController();
    const asked = coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0ONE",
      limit: 1,
      now: clock.now,
      pause,
      reads,
      run: one.run,
      signal: control.signal,
      waitMs: WAIT_MS,
    });
    const startedBeforeAnyMicrotask = [...starts];
    control.abort();
    one.release();

    expect(startedBeforeAnyMicrotask).toEqual(["C0ONE read"]);
    expect(await asked).toBe("busy");
  });

  it("answers busy for a caller that aborts after joining a read, which still answers the caller that started it", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const control = new AbortController();
    const ask = ({ signal }: { signal: AbortSignal }): Promise<string> =>
      coalescedRead({
        busy: () => "busy",
        holdMs: HOLD_MS,
        key: "C0ONE",
        limit: 1,
        now: clock.now,
        pause,
        reads,
        run: one.run,
        signal,
        waitMs: WAIT_MS,
      });
    const starter = ask({ signal: live() });
    const joiner = ask({ signal: control.signal });
    control.abort();

    expect(await joiner).toBe("busy");
    expect(getEventListeners(control.signal, "abort").length).toBe(0);
    one.release();
    expect(await starter).toBe("C0ONE read");
    expect(starts).toEqual(["C0ONE read"]);
  });
});
