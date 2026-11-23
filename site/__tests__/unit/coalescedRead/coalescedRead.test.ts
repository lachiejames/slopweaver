import { describe, expect, it } from "vitest";
import { type CoalescedEntry, coalescedRead } from "../../../lib/coalescedRead";
import { handClock, handPause, heldRead, live } from "./harness";

describe("coalescedRead", () => {
  const HOLD_MS = 15_000;

  it("joins a read already running for the same key instead of starting another", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const held = heldRead({ answer: "C0ONE read", starts });
    const ask = (): Promise<string> =>
      coalescedRead({
        busy: () => "busy",
        holdMs: HOLD_MS,
        key: "C0ONE",
        limit: 1,
        now: clock.now,
        pause,
        reads,
        run: held.run,
        signal: live(),
        waitMs: 0,
      });
    const first = ask();
    const second = ask();
    held.release();

    expect(await Promise.all([first, second])).toEqual(["C0ONE read", "C0ONE read"]);
    expect(starts).toEqual(["C0ONE read"]);
  });

  it("answers busy at once past the limit when it has no wait, without starting the read", async () => {
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
        waitMs: 0,
      });
    const running = ask({ key: "C0ONE", run: one.run });
    const refused = await ask({ key: "C0TWO", run: two.run });
    one.release();

    expect(refused).toBe("busy");
    expect(await running).toBe("C0ONE read");
    expect(starts).toEqual(["C0ONE read"]);
  });

  it("answers a revisit inside the hold with the settled read, then reads afresh once it has passed", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const first = heldRead({ answer: "first", starts });
    const second = heldRead({ answer: "second", starts });
    const ask = ({ run }: { run: () => Promise<string> }): Promise<string> =>
      coalescedRead({
        busy: () => "busy",
        holdMs: HOLD_MS,
        key: "C0ONE",
        limit: 1,
        now: clock.now,
        pause,
        reads,
        run,
        signal: live(),
        waitMs: 0,
      });
    const pending = ask({ run: first.run });
    first.release();
    await pending;

    clock.advance({ ms: HOLD_MS - 1 });
    expect(await ask({ run: second.run })).toBe("first");
    expect(starts).toEqual(["first"]);

    clock.advance({ ms: 1 });
    const again = ask({ run: second.run });
    second.release();
    expect(await again).toBe("second");
    expect(starts).toEqual(["first", "second"]);
  });

  it("counts a read against the limit even when its own run asks again before returning", async () => {
    const reads = new Map<string, CoalescedEntry<string>>();
    const clock = handClock();
    const { pause } = handPause();
    const starts: string[] = [];
    const two = heldRead({ answer: "C0TWO read", starts });
    const nested: Promise<string>[] = [];
    const one = heldRead({ answer: "C0ONE read", starts });
    const reentrant = (): Promise<string> => {
      const answer = one.run();
      nested.push(
        coalescedRead({
          busy: () => "busy",
          holdMs: HOLD_MS,
          key: "C0TWO",
          limit: 1,
          now: clock.now,
          pause,
          reads,
          run: two.run,
          signal: live(),
          waitMs: 0,
        }),
      );
      return answer;
    };
    const running = coalescedRead({
      busy: () => "busy",
      holdMs: HOLD_MS,
      key: "C0ONE",
      limit: 1,
      now: clock.now,
      pause,
      reads,
      run: reentrant,
      signal: live(),
      waitMs: 0,
    });
    one.release();
    two.release();

    expect(await running).toBe("C0ONE read");
    expect(await Promise.all(nested)).toEqual(["busy"]);
    expect(starts).toEqual(["C0ONE read"]);
  });

  it("does not count a settled answer it is holding against the running limit", async () => {
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
        waitMs: 0,
      });
    const settled = ask({ key: "C0ONE", run: one.run });
    one.release();
    await settled;
    const next = ask({ key: "C0TWO", run: two.run });
    two.release();

    expect(await next).toBe("C0TWO read");
    expect(starts).toEqual(["C0ONE read", "C0TWO read"]);
  });
});
