import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { type CoalescedEntry, coalescedRead } from "../../../lib/coalescedRead";
import { handClock, handPause, heldRead, live } from "./harness";

describe("coalescedRead waiting for a slot", () => {
  const HOLD_MS = 15_000;
  const WAIT_MS = 10_000;

  it("answers busy once the wait's own timer fires while the slot is still taken", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const hand = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const two = heldRead({ answer: "C0TWO read", starts });
    const running = coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0ONE",
      limit: 1,
      now: clock.now,
      pause: hand.pause,
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
      pause: hand.pause,
      reads,
      run: two.run,
      signal: live(),
      waitMs: WAIT_MS,
    });
    hand.fire();

    expect(await waiting).toBe("busy");
    one.release();
    expect(await running).toBe("C0ONE read");
    expect(starts).toEqual(["C0ONE read"]);
  });

  it("starts one child per settle across three channels, and one child for two waiters on the same channel", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const two = heldRead({ answer: "C0TWO read", starts });
    const three = heldRead({ answer: "C0THREE read", starts });
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
    const answers = [
      ask({ key: "C0ONE", run: one.run }),
      ask({ key: "C0TWO", run: two.run }),
      ask({ key: "C0TWO", run: two.run }),
      ask({ key: "C0THREE", run: three.run }),
    ];
    one.release();
    two.release();
    three.release();

    expect(await Promise.all(answers)).toEqual(["C0ONE read", "C0TWO read", "C0TWO read", "C0THREE read"]);
    expect(starts).toEqual(["C0ONE read", "C0TWO read", "C0THREE read"]);
  });

  it("releases its one timer and its abort listener whether it starts, waits and wins, or is abandoned", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const hand = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const two = heldRead({ answer: "C0TWO read", starts });
    const signals = [new AbortController(), new AbortController(), new AbortController()];
    const ask = ({
      key,
      run,
      control,
    }: {
      key: string;
      run: () => Promise<string>;
      control: AbortController;
    }): Promise<string> =>
      coalescedRead({
        busy: () => "busy",
        holdMs: HOLD_MS,
        key,
        limit: 1,
        now: clock.now,
        pause: hand.pause,
        reads,
        run,
        signal: control.signal,
        waitMs: WAIT_MS,
      });
    const running = ask({ control: signals[0], key: "C0ONE", run: one.run });
    const winsTheSlot = ask({ control: signals[1], key: "C0TWO", run: two.run });
    const abandons = ask({ control: signals[2], key: "C0THREE", run: two.run });
    signals[2].abort();
    expect(await abandons).toBe("busy");
    one.release();
    two.release();
    expect(await Promise.all([running, winsTheSlot])).toEqual(["C0ONE read", "C0TWO read"]);

    expect(hand.calls.map((call) => call.ms)).toEqual([WAIT_MS, WAIT_MS, WAIT_MS]);
    expect(hand.calls.map((call) => call.signal.aborted)).toEqual([true, true, true]);
    expect(signals.map((control) => getEventListeners(control.signal, "abort").length)).toEqual([0, 0, 0]);
  });

  it("releases its listener when its wait expires", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const hand = handPause();
    const starts: string[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const control = new AbortController();
    const running = coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0ONE",
      limit: 1,
      now: clock.now,
      pause: hand.pause,
      reads,
      run: one.run,
      signal: live(),
      waitMs: WAIT_MS,
    });
    const expires = coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0TWO",
      limit: 1,
      now: clock.now,
      pause: hand.pause,
      reads,
      run: one.run,
      signal: control.signal,
      waitMs: WAIT_MS,
    });
    expect(getEventListeners(control.signal, "abort").length).toBe(1);
    hand.fire();

    expect(await expires).toBe("busy");
    expect(getEventListeners(control.signal, "abort").length).toBe(0);
    expect(hand.calls[1].signal.aborted).toBe(true);
    one.release();
    expect(await running).toBe("C0ONE read");
  });
});
