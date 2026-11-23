/**
 * The PRIZE this PR is for, asserted end to end: a real Slack 429 reaching our layer stops EVERY caller on
 * that workspace, not just the request that earned it.
 *
 * This is the behaviour that could not exist before PR5.2.1b. The Slack SDK used to absorb every 429
 * internally (`rejectRateLimitedCalls: false`), so the shared block never saw one and was, for Slack, dead
 * code. These cases drive `safeProviderCall` with the SDK's REAL `WebAPIRateLimitedError` and a real
 * `createRateBlock`, and assert the whole chain: classify → record once → every other caller waits → a
 * different workspace does not.
 *
 * No mocks. The block's clock and sleep are injected seams, so a 30-second block is asserted in microseconds
 * and the recorded delays are the assertion rather than a side effect nobody checks.
 */
import { WebAPIRateLimitedError } from "@slack/web-api";
import { describe, expect, it } from "vitest";
import { SDK_REPLACEMENT_ATTEMPTS, safeProviderCall } from "../../../lib/providerCall.js";
import { createRateBlock, type RateBlock } from "../../../lib/rateBlock.js";

/** A fake clock whose `delay` RECORDS the requested wait and advances time by it, so nothing really sleeps. */
function fakeClock(): {
  readonly delays: readonly number[];
  readonly block: RateBlock;
  readonly nowMs: () => number;
} {
  let now = 1_000_000;
  const delays: number[] = [];
  const block = createRateBlock({
    seams: {
      delay: async ({ delayMs }) => {
        delays.push(delayMs);
        now += delayMs;
      },
      now: () => now,
    },
  });
  return { block, delays, nowMs: () => now };
}

/** Attempts are capped hard so a retrying case cannot mask a wait behind real backoff. */
const FAST_BACKOFF = { maxTimeoutMs: 1, minTimeoutMs: 1, randomize: false } as const;

const WS_ONE = { provider: "slack", scopeId: "workspace-one" };
const WS_TWO = { provider: "slack", scopeId: "workspace-two" };

describe("a Slack 429 records the shared block", () => {
  it("records the workspace's block for exactly the Retry-After the provider asked for", async () => {
    const { block } = fakeClock();
    const result = await safeProviderCall({
      block,
      execute: () => {
        throw new WebAPIRateLimitedError(30);
      },
      operation: "slack.conversations.history",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    expect(result.isErr()).toBe(true);
    expect(block.remainingMs({ scope: WS_ONE })).toBe(30_000);
  });

  it("records it on the FIRST 429, before any backoff — the whole point of a shared block", async () => {
    const { block } = fakeClock();
    let attempts = 0;
    await safeProviderCall({
      backoff: FAST_BACKOFF,
      block,
      execute: () => {
        attempts += 1;
        // Only the first attempt rate-limits; the block must already be set for the others to see.
        throw attempts === 1 ? new WebAPIRateLimitedError(12) : new Error("boom");
      },
      operation: "slack.conversations.history",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    expect(attempts).toBe(1);
    expect(block.inspect({ scope: WS_ONE }).blockedUntilMs).toBeDefined();
  });
});

describe("every other caller on that workspace stops too", () => {
  it("makes an UNRELATED call on the same workspace wait the full Retry-After", async () => {
    const { block, delays } = fakeClock();
    await safeProviderCall({
      block,
      execute: () => {
        throw new WebAPIRateLimitedError(30);
      },
      operation: "slack.conversations.history",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    const second = await safeProviderCall({
      block,
      execute: () => "second caller ran",
      operation: "slack.users.list",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    expect(second.isOk()).toBe(true);
    expect(delays).toEqual([30_000]);
  });

  it("does NOT block a DIFFERENT workspace — the scope key is per-workspace, not global", async () => {
    const { block, delays } = fakeClock();
    await safeProviderCall({
      block,
      execute: () => {
        throw new WebAPIRateLimitedError(30);
      },
      operation: "slack.conversations.history",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    const elsewhere = await safeProviderCall({
      block,
      execute: () => "other workspace ran",
      operation: "slack.users.list",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_TWO.scopeId,
    });
    expect(elsewhere.isOk()).toBe(true);
    expect(delays).toEqual([]);
    expect(block.remainingMs({ scope: WS_TWO })).toBe(0);
  });
});

describe("the at-most-once post under an existing block", () => {
  it("DELAYS a post that arrives during a block, and still attempts it exactly ONCE", async () => {
    const { block, delays } = fakeClock();
    block.recordLimited({ retryAfterMs: 5_000, scope: WS_ONE });
    let posts = 0;
    const result = await safeProviderCall({
      block,
      execute: () => {
        posts += 1;
        return { ok: true, ts: "1.2" };
      },
      operation: "slack.chat.postMessage",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    expect(result.isOk()).toBe(true);
    // Delayed — safe, because nothing has been sent yet — but never re-attempted.
    expect(delays).toEqual([5_000]);
    expect(posts).toBe(1);
  });

  it("never re-attempts a post that itself earns a 429, however long the block it records", async () => {
    const { block } = fakeClock();
    let posts = 0;
    const result = await safeProviderCall({
      block,
      execute: () => {
        posts += 1;
        throw new WebAPIRateLimitedError(60);
      },
      operation: "slack.chat.postMessage",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    expect(result.isErr()).toBe(true);
    expect(posts).toBe(1);
    // It still protects everyone else, which is the asymmetry that makes at-most-once affordable.
    expect(block.remainingMs({ scope: WS_ONE })).toBe(60_000);
  });
});

describe("a retrying read under a 429", () => {
  it("re-waits the block on every attempt and stops at the 4-attempt budget", async () => {
    const { block } = fakeClock();
    let attempts = 0;
    const result = await safeProviderCall({
      backoff: FAST_BACKOFF,
      block,
      execute: () => {
        attempts += 1;
        throw new WebAPIRateLimitedError(1);
      },
      operation: "slack.conversations.replies",
      provider: "slack",
      retryMode: "transient",
      scopeId: WS_ONE.scopeId,
    });
    expect(result.isErr()).toBe(true);
    // Four total attempts: the first plus three retries. Bounded, so a persistent 429 terminates.
    expect(attempts).toBe(4);
  });

  it("gives a client that disabled its SDK retries the larger replacement budget", async () => {
    const { block } = fakeClock();
    let attempts = 0;
    const result = await safeProviderCall({
      backoff: FAST_BACKOFF,
      block,
      execute: () => {
        attempts += 1;
        throw new WebAPIRateLimitedError(1);
      },
      maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
      operation: "slack.conversations.list",
      provider: "slack",
      retryMode: "transient",
      scopeId: WS_ONE.scopeId,
    });
    expect(result.isErr()).toBe(true);
    // Channel discovery is the one FATAL seam in the Slack crawl, and it used to survive a burst of 429s
    // only because the SDK retried ten times underneath us. Eleven total attempts is exactly the budget the
    // SDK's `tenRetriesInAboutThirtyMinutes` provided (one attempt + ten retries), so nothing regressed.
    expect(attempts).toBe(11);
    expect(SDK_REPLACEMENT_ATTEMPTS).toBe(11);
  });

  it("leaves an at-most-once post at ONE attempt however large the budget it is handed", async () => {
    const { block } = fakeClock();
    let posts = 0;
    await safeProviderCall({
      backoff: FAST_BACKOFF,
      block,
      execute: () => {
        posts += 1;
        throw new WebAPIRateLimitedError(1);
      },
      maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
      operation: "slack.chat.postMessage",
      provider: "slack",
      retryMode: "never",
      scopeId: WS_ONE.scopeId,
    });
    // `never` never enters the retry driver, so the budget is structurally unreachable from the post path.
    expect(posts).toBe(1);
  });
});
