/**
 * The shared 429 block. The clock and the sleep are injected plain functions, so every timing behaviour is
 * asserted exactly with no real waiting and no mocks.
 */
import { describe, expect, it } from "vitest";

import { createRateBlock, type ProviderScope, type RateBlockSeams } from "../../../lib/rateBlock.js";

const SLACK: ProviderScope = { provider: "slack", scopeId: "workspace-a" };
const OTHER_WORKSPACE: ProviderScope = { provider: "slack", scopeId: "workspace-b" };
const LINEAR: ProviderScope = { provider: "linear", scopeId: "workspace-a" };

/** A controllable clock plus a recording sleep. A plain fake, not a mock: it records and advances. */
function fakeSeams({ startMs = 1_000_000 }: { startMs?: number } = {}): {
  readonly seams: RateBlockSeams;
  readonly delays: readonly number[];
  readonly advance: (args: { byMs: number }) => void;
} {
  let current = startMs;
  const delays: number[] = [];
  return {
    advance: ({ byMs }) => {
      current += byMs;
    },
    delays,
    seams: {
      delay: async ({ delayMs }) => {
        delays.push(delayMs);
        // A real sleep would advance the clock; the fake does the same so `waitUntilOpen` terminates.
        current += delayMs;
      },
      now: () => current,
    },
  };
}

describe("an open block", () => {
  it("reports nothing blocked and zero remaining", () => {
    const { seams } = fakeSeams();
    const block = createRateBlock({ seams });
    expect(block.inspect({ scope: SLACK })).toEqual({});
    expect(block.remainingMs({ scope: SLACK })).toBe(0);
  });

  it("returns from waitUntilOpen without sleeping at all", async () => {
    const { seams, delays } = fakeSeams();
    const block = createRateBlock({ seams });
    await block.waitUntilOpen({ scope: SLACK });
    expect(delays).toEqual([]);
  });
});

describe("recording a rate limit", () => {
  it("blocks for the provider's stated Retry-After", () => {
    const { seams } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    expect(block.recordLimited({ retryAfterMs: 5_000, scope: SLACK })).toEqual({ blockedUntilMs: 6_000 });
    expect(block.remainingMs({ scope: SLACK })).toBe(5_000);
  });

  it("uses a 30s default when the provider gave no Retry-After", () => {
    const { seams } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    expect(block.recordLimited({ scope: SLACK })).toEqual({ blockedUntilMs: 31_000 });
  });

  it("treats a zero or negative Retry-After as absent rather than as 'open immediately'", () => {
    const { seams } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    expect(block.recordLimited({ retryAfterMs: 0, scope: SLACK })).toEqual({ blockedUntilMs: 31_000 });
    expect(block.recordLimited({ retryAfterMs: -1, scope: OTHER_WORKSPACE })).toEqual({ blockedUntilMs: 31_000 });
  });

  it("keeps the LATER deadline, so a short 429 cannot shorten a long one", () => {
    const { seams } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    block.recordLimited({ retryAfterMs: 60_000, scope: SLACK });
    expect(block.recordLimited({ retryAfterMs: 1_000, scope: SLACK })).toEqual({ blockedUntilMs: 61_000 });
    expect(block.remainingMs({ scope: SLACK })).toBe(60_000);
  });

  it("extends the deadline when the later 429 asks for longer", () => {
    const { seams } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    block.recordLimited({ retryAfterMs: 1_000, scope: SLACK });
    expect(block.recordLimited({ retryAfterMs: 9_000, scope: SLACK })).toEqual({ blockedUntilMs: 10_000 });
  });
});

describe("the block's scope", () => {
  it("stops EVERY caller on the same provider and scope — the whole point of sharing it", () => {
    const { seams } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    // One request earns the 429; a second, entirely separate caller sees the same closed block.
    block.recordLimited({ retryAfterMs: 5_000, scope: { provider: "slack", scopeId: "workspace-a" } });
    expect(block.remainingMs({ scope: { provider: "slack", scopeId: "workspace-a" } })).toBe(5_000);
  });

  it("does NOT block a different workspace on the same provider", () => {
    const { seams } = fakeSeams();
    const block = createRateBlock({ seams });
    block.recordLimited({ retryAfterMs: 5_000, scope: SLACK });
    expect(block.remainingMs({ scope: OTHER_WORKSPACE })).toBe(0);
  });

  it("does NOT block a different provider with the same scope id", () => {
    const { seams } = fakeSeams();
    const block = createRateBlock({ seams });
    block.recordLimited({ retryAfterMs: 5_000, scope: SLACK });
    expect(block.remainingMs({ scope: LINEAR })).toBe(0);
  });
});

describe("a block expiring", () => {
  it("reports open once the deadline has passed, rather than a stale deadline", () => {
    const { seams, advance } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    block.recordLimited({ retryAfterMs: 5_000, scope: SLACK });
    advance({ byMs: 5_000 });
    expect(block.inspect({ scope: SLACK })).toEqual({});
    expect(block.remainingMs({ scope: SLACK })).toBe(0);
  });

  it("counts down as time passes", () => {
    const { seams, advance } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    block.recordLimited({ retryAfterMs: 5_000, scope: SLACK });
    advance({ byMs: 2_000 });
    expect(block.remainingMs({ scope: SLACK })).toBe(3_000);
  });
});

describe("waitUntilOpen", () => {
  it("sleeps exactly the remaining time", async () => {
    const { seams, delays } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    block.recordLimited({ retryAfterMs: 4_000, scope: SLACK });
    await block.waitUntilOpen({ scope: SLACK });
    expect(delays).toEqual([4_000]);
    expect(block.remainingMs({ scope: SLACK })).toBe(0);
  });

  it("re-checks after waking, so a block EXTENDED mid-wait is still honoured", async () => {
    const { seams } = fakeSeams({ startMs: 1_000 });
    const block = createRateBlock({ seams });
    const delays: number[] = [];
    // A sleep that extends the block the first time it is called — exactly what a second concurrent
    // caller earning its own 429 would do while this one waits.
    let extended = false;
    const extendingSeams: RateBlockSeams = {
      delay: async ({ delayMs }) => {
        delays.push(delayMs);
        await seams.delay({ delayMs });
        if (!extended) {
          extended = true;
          block.recordLimited({ retryAfterMs: 2_000, scope: SLACK });
        }
      },
      now: seams.now,
    };
    const extendable = createRateBlock({ seams: extendingSeams });
    extendable.recordLimited({ retryAfterMs: 3_000, scope: SLACK });
    await extendable.waitUntilOpen({ scope: SLACK });
    expect(delays.length).toBeGreaterThan(0);
    expect(extendable.remainingMs({ scope: SLACK })).toBe(0);
  });
});
