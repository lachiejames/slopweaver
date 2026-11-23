/** `createChatgptPacer`: serial spacing from the previous request's start, over an injected clock. */
import { describe, expect, it } from "vitest";

import { createChatgptPacer } from "../../../../../cli/commands/chatgpt/pacer.js";

/** A clock that only moves when the pacer sleeps, or when a test moves it. */
function fakeClock({ draws }: { draws: readonly number[] }): {
  sleeps: number[];
  advance: (args: { ms: number }) => void;
  deps: Parameters<typeof createChatgptPacer>[0]["deps"];
} {
  let now = 1_000;
  let drawn = 0;
  const sleeps: number[] = [];
  return {
    advance: ({ ms }) => {
      now += ms;
    },
    deps: {
      nowMs: () => now,
      randomInt: () => {
        const value = draws[drawn]!;
        drawn += 1;
        return value;
      },
      sleep: ({ ms }) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    },
    sleeps,
  };
}

describe("createChatgptPacer", () => {
  it("starts the first request at once and spaces each later one by the floor plus its own jitter", async () => {
    const clock = fakeClock({ draws: [500, 2_000] });
    const pacer = createChatgptPacer({ deps: clock.deps, floorMs: 3_000, jitterMs: 2_000 });
    await pacer.beforeRequest();
    expect(clock.sleeps).toEqual([]);
    clock.advance({ ms: 1_000 });
    await pacer.beforeRequest();
    await pacer.beforeRequest();
    expect(clock.sleeps).toEqual([2_500, 5_000]);
  });

  it("does not sleep when the request itself already took longer than the floor and jitter", async () => {
    const clock = fakeClock({ draws: [0] });
    const pacer = createChatgptPacer({ deps: clock.deps, floorMs: 3_000, jitterMs: 2_000 });
    await pacer.beforeRequest();
    clock.advance({ ms: 9_000 });
    await pacer.beforeRequest();
    expect(clock.sleeps).toEqual([]);
  });

  it("draws no jitter when there is none to draw", async () => {
    const clock = fakeClock({ draws: [] });
    const pacer = createChatgptPacer({ deps: clock.deps, floorMs: 3_000, jitterMs: 0 });
    await pacer.beforeRequest();
    await pacer.beforeRequest();
    expect(clock.sleeps).toEqual([3_000]);
  });
});
