/*
 * The voice window's screen asks: one in flight, one queued behind it, and the queued one never started once every
 * caller waiting on it is past its own time.
 */
import { describe, expect, it } from "vitest";

import { screenAskChain } from "../../lib/screenAskChain";

/**
 * A chain whose asks settle only when the test says, on a hand-moved clock.
 *
 * @returns the chain, every ask it started, how to settle the oldest one still out, and the clock
 */
function handChain(): {
  readonly chain: ReturnType<typeof screenAskChain>;
  readonly started: number[];
  readonly settle: () => Promise<void>;
  readonly clock: { now: number };
} {
  const clock = { now: 0 };
  const started: number[] = [];
  const pending: (() => void)[] = [];
  const start = (): Promise<void> => {
    started.push(clock.now);
    return new Promise((resolve) => {
      pending.push(resolve);
    });
  };
  const settle = async (): Promise<void> => {
    pending.shift()!();
    // Let the settled ask's continuations, the queued start included, run.
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  };
  return { chain: screenAskChain({ nowMs: () => clock.now, start }), clock, settle, started };
}

describe("screenAskChain", () => {
  it("starts an ask at once when none is in flight", () => {
    const { chain, started } = handChain();
    void chain.asked({ startBy: 20_000 });
    expect(started).toEqual([0]);
  });

  it("queues one ask behind the one in flight, and every caller arriving meanwhile joins it", async () => {
    const { chain, clock, settle, started } = handChain();
    void chain.asked({ startBy: 20_000 });
    clock.now = 1_000;
    const second = chain.asked({ startBy: 21_000 });
    const third = chain.asked({ startBy: 22_000 });
    expect(second).toBe(third);
    clock.now = 5_000;
    await settle();
    expect(started).toEqual([0, 5_000]);
  });

  it("never starts the queued ask once every caller waiting on it is past its time", async () => {
    const { chain, clock, settle, started } = handChain();
    void chain.asked({ startBy: 21_000 });
    void chain.asked({ startBy: 20_000 });
    clock.now = 21_000;
    await settle();
    expect(started).toEqual([0]);
    // The next caller is not left behind a skipped ask: it starts its own.
    void chain.asked({ startBy: 41_000 });
    expect(started).toEqual([0, 21_000]);
  });

  // With none in flight, an ask started for a caller whose time had already run out.
  it("starts nothing for a caller already past its time when none is in flight, and says it was not asked", async () => {
    const { chain, clock, started } = handChain();
    clock.now = 20_000;
    expect(await chain.asked({ startBy: 20_000 })).toEqual({ asked: false });
    expect(started).toEqual([]);
  });

  it("says each caller's ask was made, or skipped once every caller on it was past its time", async () => {
    const { chain, clock, settle } = handChain();
    const first = chain.asked({ startBy: 21_000 });
    const queued = chain.asked({ startBy: 20_000 });
    clock.now = 21_000;
    await settle();
    expect([await first, await queued]).toEqual([{ asked: true }, { asked: false }]);
  });

  it("starts the queued ask while the latest caller joining it still has time, though an earlier one is past", async () => {
    const { chain, clock, settle, started } = handChain();
    void chain.asked({ startBy: 30_000 });
    void chain.asked({ startBy: 20_000 });
    void chain.asked({ startBy: 35_000 });
    clock.now = 25_000;
    await settle();
    expect(started).toEqual([0, 25_000]);
  });
});
