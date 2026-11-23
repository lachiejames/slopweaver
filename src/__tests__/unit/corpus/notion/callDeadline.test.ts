/**
 * The per-call deadline every Notion lane races, and the discovery budget, asserted against the failure that
 * earned it: a `resync-corpus-notion` firing lost both lanes to undici's `fetch failed` lasting
 * longer than the door's default four attempts. The budget cases drive the real `safeProviderCall` with that
 * exact thrown shape.
 *
 * Every seam is a plain counting fake over an isolated block — no mocks, no network, no real sleep.
 */
import { describe, expect, it } from "vitest";

import {
  type CallDeadline,
  gatedCallWithDeadline,
  NOTION_FATAL_SEAM_ATTEMPTS,
  NOTION_RATE_PER_SEC,
} from "../../../../corpus/notion/callDeadline.js";
import { safeProviderCall } from "../../../../lib/providerCall.js";
import { createRateBlock, type RateBlock } from "../../../../lib/rateBlock.js";
import type { RateScheduler } from "../../../../lib/resilience.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A scheduler that records it was entered and then runs the task at once. */
function recordingScheduler({ log }: { log: string[] }): RateScheduler {
  return async (task) => {
    log.push("scheduler");
    return task();
  };
}

/** A block over a controllable clock, so nothing here waits or leaks into another test. */
function isolatedBlock(): RateBlock {
  let current = 1_000;
  return createRateBlock({
    seams: {
      delay: async ({ delayMs }) => {
        current += delayMs;
      },
      now: () => current,
    },
  });
}

/** Backoff collapsed to a millisecond, so ten retries cost nothing real. */
const FAST_BACKOFF = { maxTimeoutMs: 1, minTimeoutMs: 1, randomize: false } as const;

/** A seam that throws `fetch failed` — undici's transport failure, verbatim — `failures` times, then answers. */
function flakyNetwork({ failures }: { failures: number }): {
  readonly calls: () => number;
  readonly execute: () => string;
} {
  let calls = 0;
  return {
    calls: () => calls,
    execute: () => {
      calls += 1;
      if (calls <= failures) {
        throw new TypeError("fetch failed");
      }
      return "data sources";
    },
  };
}

describe("NOTION_RATE_PER_SEC", () => {
  it("is Notion's documented all-tier ceiling of three requests a second", () => {
    expect(NOTION_RATE_PER_SEC).toBe(3);
  });
});

describe("gatedCallWithDeadline", () => {
  it("enters the scheduler first, then races the original task against a 90-second deadline", async () => {
    const log: string[] = [];
    const seenTasks: unknown[] = [];
    const deadline: CallDeadline = async ({ task, timeoutMs }) => {
      log.push(`deadline ${String(timeoutMs)}`);
      seenTasks.push(task);
      return task();
    };
    const task = async (): Promise<string> => {
      log.push("task");
      return "value-alpha";
    };
    const call = gatedCallWithDeadline({ deadline, scheduler: recordingScheduler({ log }) });
    expect(await call(task)).toBe("value-alpha");
    expect(log).toEqual(["scheduler", "deadline 90000", "task"]);
    expect(seenTasks).toEqual([task]);
    expect(seenTasks[0]).toBe(task);
  });

  it("propagates the deadline's own rejection unchanged", async () => {
    const stuck = Object.assign(new Error("stuck call: no response after 90000ms"), { code: "ETIMEDOUT" });
    const deadline: CallDeadline = async () => {
      throw stuck;
    };
    const call = gatedCallWithDeadline({ deadline, scheduler: recordingScheduler({ log: [] }) });
    await expect(call(async () => "never-read")).rejects.toBe(stuck);
  });

  it("propagates a rejection from the task itself through the deadline", async () => {
    const failure = new Error("notion said no");
    const deadline: CallDeadline = async ({ task }) => task();
    const call = gatedCallWithDeadline({ deadline, scheduler: recordingScheduler({ log: [] }) });
    await expect(
      call(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});

describe("NOTION_FATAL_SEAM_ATTEMPTS", () => {
  it("rides out ten consecutive `fetch failed` and returns the eleventh answer", async () => {
    const seam = flakyNetwork({ failures: 10 });
    const result = await safeProviderCall({
      backoff: FAST_BACKOFF,
      block: isolatedBlock(),
      execute: seam.execute,
      maxAttempts: NOTION_FATAL_SEAM_ATTEMPTS,
      operation: "notion.search.dataSources",
      provider: "notion",
      retryMode: "transient",
      scopeId: "workspace",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("data sources");
    expect(seam.calls()).toBe(11);
    expect(NOTION_FATAL_SEAM_ATTEMPTS).toBe(11);
  });

  it("is what separates the run from the incident: the door's default gives up on the same blip", async () => {
    const seam = flakyNetwork({ failures: 10 });
    const result = await safeProviderCall({
      backoff: FAST_BACKOFF,
      block: isolatedBlock(),
      execute: seam.execute,
      operation: "notion.search.dataSources",
      provider: "notion",
      retryMode: "transient",
      scopeId: "workspace",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).kind).toBe("network");
    expect(unwrapErr(result).message).toBe("fetch failed");
    expect(seam.calls()).toBe(4);
  });

  it("still fails a revoked token on the FIRST attempt — the budget buys patience only for transients", async () => {
    let calls = 0;
    const result = await safeProviderCall({
      backoff: FAST_BACKOFF,
      block: isolatedBlock(),
      execute: () => {
        calls += 1;
        throw Object.assign(new Error("API token is invalid."), { status: 401 });
      },
      maxAttempts: NOTION_FATAL_SEAM_ATTEMPTS,
      operation: "notion.users.list",
      provider: "notion",
      retryMode: "transient",
      scopeId: "workspace",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).status).toBe(401);
    expect(calls).toBe(1);
  });
});
