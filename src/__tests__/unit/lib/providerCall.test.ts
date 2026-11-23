/**
 * The paced provider call, and above all the ONE property this PR must not regress.
 *
 * PR5.1 found `chat.postMessage` running under `WebClient`'s default ten retries AND `retryTransient`'s
 * four — up to ~44 attempts at an irreversible POST, where a request Slack PROCESSES and whose response is
 * then lost is indistinguishable from one that never arrived, so a retry double-posts invisibly to the
 * O_EXCL reservation. PR5.2 adds rate limiting to the same call path, and the obvious tidy-up while doing
 * that is to route posting through the shared retry "for consistency". These tests fail if anyone does.
 *
 * Every seam is a plain counting fake — no mocks anywhere, per the repo's testing rules.
 */
import { describe, expect, it } from "vitest";
import {
  isPacedClass,
  type ProviderBackoff,
  type ProviderRetryObserver,
  safeProviderCall,
} from "../../../lib/providerCall.js";
import { createRateBlock, type RateBlock } from "../../../lib/rateBlock.js";
import { unwrap } from "../../../lib/result.js";

/** A block over a controllable clock, so a recorded 429 cannot leak into another test. */
function isolatedBlock({ startMs = 1_000 }: { startMs?: number } = {}): {
  readonly block: RateBlock;
  readonly delays: readonly number[];
} {
  let current = startMs;
  const delays: number[] = [];
  return {
    block: createRateBlock({
      seams: {
        delay: async ({ delayMs }) => {
          delays.push(delayMs);
          current += delayMs;
        },
        now: () => current,
      },
    }),
    delays,
  };
}

/** An error shaped like a rate-limited SDK response: retryable, and the tempting one to retry. */
function rateLimited(): Error & { status: number } {
  return Object.assign(new Error("ratelimited"), { status: 429 });
}

/** A counting fake that always throws the supplied error. */
function alwaysThrows({ error }: { error: Error }): { readonly execute: () => never; readonly calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    execute: (): never => {
      calls += 1;
      throw error;
    },
  };
}

/** `linear` is registered but unpaced, so these tests exercise retry counts without real waiting. */
const UNPACED = { operation: "linear.issues.list", provider: "linear", scopeId: "scope-1" } as const;

/** The scope `UNPACED` resolves to, for a block assertion. */
const UNPACED_SCOPE = { provider: "linear", scopeId: "scope-1" } as const;

/**
 * A real but tiny schedule, for the tests that assert attempt COUNTS rather than spacing.
 *
 * Deliberately not `minTimeoutMs: 0`. A zero here would work, but it would put a copy-pasteable
 * "spacing off" literal in the repo for the very door whose missing spacing this PR is fixing — and the
 * whole schedule costs 7ms, so there is nothing to buy by switching it off.
 */
const FAST_BACKOFF: ProviderBackoff = { maxTimeoutMs: 4, minTimeoutMs: 1, randomize: false };

/**
 * A block and a backoff observer over ONE shared fake clock.
 *
 * Sharing the clock is what makes the absorbed-wait property visible: a rate-limit deadline is absolute, so
 * the backoff taken before it and the block's own wait must ADD UP to the `Retry-After` rather than stack on
 * top of it. The observer is separate from the tuning, so a caller can watch the schedule while leaving the
 * schedule at the shipped default — `p-retry` owns the sleep and takes no injected sleeper, so what is
 * asserted here is the delay it REQUESTED, and only a shrunken tuning makes the real wait negligible.
 */
function pacedHarness({ startMs = 1_000 }: { startMs?: number } = {}): {
  readonly block: RateBlock;
  readonly blockDelays: readonly number[];
  readonly backoffDelays: readonly number[];
  readonly onRetryDelay: NonNullable<ProviderRetryObserver>;
  readonly elapsedMs: () => number;
} {
  let current = startMs;
  const blockDelays: number[] = [];
  const backoffDelays: number[] = [];
  return {
    backoffDelays,
    block: createRateBlock({
      seams: {
        delay: async ({ delayMs }) => {
          blockDelays.push(delayMs);
          current += delayMs;
        },
        now: () => current,
      },
    }),
    blockDelays,
    elapsedMs: () => current - startMs,
    onRetryDelay: ({ delayMs }) => {
      backoffDelays.push(delayMs);
      current += delayMs;
    },
  };
}

describe("isPacedClass", () => {
  it("spaces KnowBe4's and Make's reads, whose allowances other integrations share, and leaves Linear's alone", () => {
    expect([
      isPacedClass({ endpointClass: "read", provider: "knowbe4" }),
      isPacedClass({ endpointClass: "read", provider: "make" }),
      isPacedClass({ endpointClass: "write", provider: "github" }),
      isPacedClass({ endpointClass: "read", provider: "linear" }),
    ]).toEqual([true, true, true, false]);
  });
});

describe("retryMode: never — the at-most-once guarantee", () => {
  it("attempts an irreversible call EXACTLY ONCE even when the error is retryable", async () => {
    const { block } = isolatedBlock();
    const fake = alwaysThrows({ error: rateLimited() });
    const result = await safeProviderCall({ ...UNPACED, block, execute: fake.execute, retryMode: "never" });
    expect(result.isErr()).toBe(true);
    expect(fake.calls()).toBe(1);
  });

  it("attempts exactly once for a 5xx too, which is the other tempting-to-retry shape", async () => {
    const { block } = isolatedBlock();
    const fake = alwaysThrows({ error: Object.assign(new Error("bad gateway"), { status: 502 }) });
    await safeProviderCall({ ...UNPACED, block, execute: fake.execute, retryMode: "never" });
    expect(fake.calls()).toBe(1);
  });

  it("still RECORDS the 429 on the shared block, so other callers stop even though this one does not retry", async () => {
    const { block } = isolatedBlock();
    const fake = alwaysThrows({ error: Object.assign(new Error("ratelimited"), { retryAfter: 7, status: 429 }) });
    await safeProviderCall({ ...UNPACED, block, execute: fake.execute, retryMode: "never" });
    expect(block.remainingMs({ scope: { provider: "linear", scopeId: "scope-1" } })).toBeGreaterThan(0);
  });

  it("WAITS for an existing block before its single attempt, which is safe because nothing was sent yet", async () => {
    const { block, delays } = isolatedBlock();
    block.recordLimited({ retryAfterMs: 4_000, scope: { provider: "linear", scopeId: "scope-1" } });
    let calls = 0;
    const result = await safeProviderCall({
      ...UNPACED,
      block,
      execute: () => {
        calls += 1;
        return "posted";
      },
      retryMode: "never",
    });
    expect(delays).toEqual([4_000]);
    expect(calls).toBe(1);
    expect(result.isOk()).toBe(true);
  });
});

describe("retryMode: transient — the repeatable calls", () => {
  it("retries a rate-limited call up to four attempts in total", async () => {
    const { block } = isolatedBlock();
    const fake = alwaysThrows({ error: rateLimited() });
    // A shrunken schedule: this asserts the attempt BUDGET, and the real production spacing (500ms → 2s)
    // would cost this one test three and a half seconds. The schedule is asserted in "backoff between
    // attempts", including one test that leaves the default alone.
    await safeProviderCall({ ...UNPACED, backoff: FAST_BACKOFF, block, execute: fake.execute, retryMode: "transient" });
    expect(fake.calls()).toBe(4);
  });

  it("stops at the first attempt for a PERMANENT error rather than burning the budget", async () => {
    const { block } = isolatedBlock();
    const fake = alwaysThrows({ error: Object.assign(new Error("not_found"), { status: 404 }) });
    await safeProviderCall({ ...UNPACED, block, execute: fake.execute, retryMode: "transient" });
    expect(fake.calls()).toBe(1);
  });

  it("returns as soon as an attempt succeeds", async () => {
    const { block } = isolatedBlock();
    let calls = 0;
    const result = await safeProviderCall({
      ...UNPACED,
      backoff: FAST_BACKOFF,
      block,
      execute: () => {
        calls += 1;
        if (calls < 2) {
          throw rateLimited();
        }
        return "ok";
      },
      retryMode: "transient",
    });
    expect(calls).toBe(2);
    expect(result.isOk()).toBe(true);
  });
});

/**
 * The backoff, which PR5.2 dropped when it moved the retry loop into this door.
 *
 * These are the tests the previous suite could not have: it injected instant fakes and asserted attempt
 * COUNTS, so four attempts fired back-to-back with zero spacing looked identical to four attempts spaced
 * 500ms → 1s → 2s. Nothing here asserts a count that the tests above do not already cover; every assertion
 * is about WHEN, which is the property that was missing.
 */
describe("backoff between attempts", () => {
  it("spaces retried attempts by an INCREASING delay rather than firing them back-to-back", async () => {
    const { block, onRetryDelay, backoffDelays, blockDelays } = pacedHarness();
    const fake = alwaysThrows({ error: Object.assign(new Error("bad gateway"), { status: 502 }) });
    await safeProviderCall({
      ...UNPACED,
      backoff: { maxTimeoutMs: 8, minTimeoutMs: 1, randomize: false },
      block,
      execute: fake.execute,
      onRetryDelay,
      retryMode: "transient",
    });
    expect(fake.calls()).toBe(4);
    expect(backoffDelays).toEqual([1, 2, 4]);
    // A 5xx on an unpaced class records nothing on the block, so the spacing above is the ONLY spacing there
    // is — which is exactly why its absence was invisible.
    expect(blockDelays).toEqual([]);
  });

  it("caps the growth at maxTimeoutMs instead of doubling without limit", async () => {
    const { block, onRetryDelay, backoffDelays } = pacedHarness();
    const fake = alwaysThrows({ error: Object.assign(new Error("econnreset"), { code: "ECONNRESET" }) });
    await safeProviderCall({
      ...UNPACED,
      backoff: { maxTimeoutMs: 2, minTimeoutMs: 1, randomize: false },
      block,
      execute: fake.execute,
      onRetryDelay,
      retryMode: "transient",
    });
    expect(backoffDelays).toEqual([1, 2, 2]);
  });

  /**
   * The one test that overrides no NUMBER, so it asserts the spacing a real call site actually gets.
   *
   * Every other test here shrinks the schedule, which proves the wiring but not the shipped base. This one
   * supplies `randomize: false` and nothing else, so `retryTransient`'s own 500 ms reaches `p-retry`
   * untouched and the requested delay is exactly 500 — the door does not substitute a base of its own, which
   * is an end-to-end fact no pure test can reach. It costs one deterministic 500 ms wait, the only real
   * waiting in this file, and the reason the fake fails just once.
   *
   * ## Why the JITTERED draw is not sampled here
   *
   * It used to be, as a range assertion, and that was wrong twice over. Written exclusively it failed at
   * random on its own reachable boundary — CI run 35246992026, "expected 1000 to be less than 1000", on a
   * diff touching neither this file nor `providerCall.ts`; first measured on run 32624025722. Written
   * inclusively it accepts the entire reachable output space of the code under test, so it cannot fail even
   * if `randomize` flipped to false. Injecting the random source would settle both, and cannot be done:
   * `p-retry@8.0.1` calls `Math.random()` inline (`node_modules/p-retry/index.js:68`), exposes no random seam
   * and no injectable sleeper, and this repo bans `vi.spyOn`. So the jitter's INPUTS — `randomize: true`
   * among them — are asserted exactly and without a clock over `resolvedRetryOptions`, in
   * `unit/lib/resilience.test.ts`, and the closed `[500, 1000]` range is stated on that function's own doc.
   */
  it("spaces the first retry by the shipped 500ms base when no number is overridden", async () => {
    const { block, onRetryDelay, backoffDelays, blockDelays } = pacedHarness();
    let calls = 0;
    const result = await safeProviderCall({
      ...UNPACED,
      backoff: { randomize: false },
      block,
      execute: () => {
        calls += 1;
        if (calls < 2) {
          throw Object.assign(new Error("bad gateway"), { status: 502 });
        }
        return "ok";
      },
      onRetryDelay,
      retryMode: "transient",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("ok");
    expect(calls).toBe(2);
    expect(backoffDelays).toEqual([500]);
    // A 502 on an unpaced class records nothing on the block, so the 500ms above is the only spacing there
    // is — the same property the first case in this block asserts over a shrunken schedule.
    expect(blockDelays).toEqual([]);
  });

  it("requests NO backoff for an irreversible call, which never enters the retry driver at all", async () => {
    const { block, onRetryDelay, backoffDelays } = pacedHarness();
    const fake = alwaysThrows({ error: Object.assign(new Error("bad gateway"), { status: 502 }) });
    await safeProviderCall({ ...UNPACED, block, execute: fake.execute, onRetryDelay, retryMode: "never" });
    expect(fake.calls()).toBe(1);
    expect(backoffDelays).toEqual([]);
  });

  it("requests no backoff for a PERMANENT error, which is not worth spacing out", async () => {
    const { block, onRetryDelay, backoffDelays } = pacedHarness();
    const fake = alwaysThrows({ error: Object.assign(new Error("not_found"), { status: 404 }) });
    await safeProviderCall({ ...UNPACED, block, execute: fake.execute, onRetryDelay, retryMode: "transient" });
    expect(fake.calls()).toBe(1);
    expect(backoffDelays).toEqual([]);
  });

  it("requests no backoff for a cassette replay miss, which no wait can ever clear", async () => {
    const { block, onRetryDelay, backoffDelays } = pacedHarness();
    const miss = Object.assign(new Error("Recording for the following request is not found"), { name: "PollyError" });
    const fake = alwaysThrows({ error: miss });
    await safeProviderCall({ ...UNPACED, block, execute: fake.execute, onRetryDelay, retryMode: "transient" });
    expect(fake.calls()).toBe(1);
    expect(backoffDelays).toEqual([]);
  });

  it("waits a Retry-After ONCE across both layers, because the block's deadline absorbs the backoff", async () => {
    const { block, onRetryDelay, backoffDelays, blockDelays, elapsedMs } = pacedHarness();
    let calls = 0;
    const result = await safeProviderCall({
      ...UNPACED,
      backoff: { maxTimeoutMs: 400, minTimeoutMs: 50, randomize: false },
      block,
      execute: () => {
        calls += 1;
        if (calls < 2) {
          throw Object.assign(new Error("ratelimited"), { retryAfter: 7, status: 429 });
        }
        return "ok";
      },
      onRetryDelay,
      retryMode: "transient",
    });
    expect(result.isOk()).toBe(true);
    expect(calls).toBe(2);
    // 50ms of generic backoff, then the block asks for the REMAINING 6,950ms of the 7s deadline it recorded.
    expect(backoffDelays).toEqual([50]);
    expect(blockDelays).toEqual([6_950]);
    // The two waits add up to the Retry-After exactly. Were the retry loop to sleep `retryAfterMs` itself as
    // well, this would be 14,000 — one wait per layer, for a hint the provider gave once.
    expect(elapsedMs()).toBe(7_000);
  });

  it("still blocks EVERY caller for the full Retry-After, which the absorbed backoff must not shorten", async () => {
    const { block, onRetryDelay } = pacedHarness();
    const fake = alwaysThrows({ error: Object.assign(new Error("ratelimited"), { retryAfter: 7, status: 429 }) });
    await safeProviderCall({
      ...UNPACED,
      backoff: { maxTimeoutMs: 400, minTimeoutMs: 50, randomize: false },
      block,
      execute: fake.execute,
      onRetryDelay,
      retryMode: "transient",
    });
    // The last attempt re-recorded the deadline, so a caller arriving now still owes the whole 7s.
    expect(block.remainingMs({ scope: UNPACED_SCOPE })).toBe(7_000);
  });
});

describe("a cassette replay miss", () => {
  it("is attempted exactly ONCE even in transient mode, because retrying it burns the whole test run", async () => {
    const { block } = isolatedBlock();
    const miss = Object.assign(new Error("Recording for the following request is not found"), { name: "PollyError" });
    const fake = alwaysThrows({ error: miss });
    await safeProviderCall({ ...UNPACED, block, execute: fake.execute, retryMode: "transient" });
    expect(fake.calls()).toBe(1);
  });

  it("does not record a block for it, because the provider was never involved", async () => {
    const { block } = isolatedBlock();
    const miss = Object.assign(new Error("not found in cassette"), { name: "PollyError", status: 429 });
    await safeProviderCall({
      ...UNPACED,
      block,
      execute: alwaysThrows({ error: miss }).execute,
      retryMode: "transient",
    });
    expect(block.remainingMs({ scope: { provider: "linear", scopeId: "scope-1" } })).toBe(0);
  });
});

describe("a successful call", () => {
  it("runs once and returns the value", async () => {
    const { block, delays } = isolatedBlock();
    let calls = 0;
    const result = await safeProviderCall({
      ...UNPACED,
      block,
      execute: () => {
        calls += 1;
        return { ts: "1700000000.000100" };
      },
      retryMode: "transient",
    });
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ ts: "1700000000.000100" });
  });

  it("captures a SYNCHRONOUS throw as a typed error rather than letting it escape", async () => {
    const { block } = isolatedBlock();
    const result = await safeProviderCall({
      ...UNPACED,
      block,
      execute: () => {
        throw new Error("thrown synchronously");
      },
      retryMode: "never",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().operation).toBe("linear.issues.list");
  });
});

describe("scope isolation", () => {
  it("a block on one scope does not delay a different scope", async () => {
    const { block, delays } = isolatedBlock();
    block.recordLimited({ retryAfterMs: 9_000, scope: { provider: "linear", scopeId: "scope-1" } });
    await safeProviderCall({
      block,
      execute: () => "ok",
      operation: "linear.issues.list",
      provider: "linear",
      retryMode: "never",
      scopeId: "scope-2",
    });
    expect(delays).toEqual([]);
  });
});
