import { RequestTimeoutError } from "@notionhq/client";
import { describe, expect, it } from "vitest";
import { toIngestError } from "../../../lib/ingestError.js";
import {
  createConcurrencyLimiter,
  createRateScheduler,
  isCassetteReplayMiss,
  isTransientError,
  resolvedRetryOptions,
  retryDecision,
  retryTransient,
  withTimeout,
} from "../../../lib/resilience.js";

/** A deferred promise handle, so a test controls exactly when a task resolves. */
function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** An `Error` carrying an HTTP `status` — the shape a real SDK throws (p-retry only accepts Errors). */
function httpError({ status }: { status: number }): Error {
  return Object.assign(new Error(`HTTP ${String(status)}`), { status });
}

/** Map a thrown value to the typed error the classifier now consumes (the real safe-wrapper path). */
function typed({ error, defaultKind = "http" }: { error: unknown; defaultKind?: "http" | "io" | "parse" | "llm" }) {
  return toIngestError({ defaultKind, error, operation: "test.op", provider: "test" });
}

describe("isTransientError", () => {
  it("treats a 429 (rate-limit) and the transient 5xx family (http) as retryable", () => {
    expect(isTransientError({ error: typed({ error: { status: 429 } }) })).toBe(true);
    expect(isTransientError({ error: typed({ error: { status: 500 } }) })).toBe(true);
    expect(isTransientError({ error: typed({ error: { statusCode: 503 } }) })).toBe(true);
    expect(isTransientError({ error: typed({ error: { response: { status: 502 } } }) })).toBe(true);
  });

  it("treats a known network code and a `fetch failed` message (network kind) as retryable", () => {
    expect(isTransientError({ error: typed({ error: { code: "ECONNRESET" } }) })).toBe(true);
    expect(isTransientError({ error: typed({ error: new Error("fetch failed") }) })).toBe(true);
  });

  it("treats any other 4xx (http) or a parse/io/llm error as permanent", () => {
    expect(isTransientError({ error: typed({ error: { status: 400 } }) })).toBe(false);
    expect(isTransientError({ error: typed({ error: { status: 404 } }) })).toBe(false);
    expect(isTransientError({ error: typed({ defaultKind: "parse", error: new SyntaxError("bad json") }) })).toBe(
      false,
    );
    expect(
      isTransientError({
        error: typed({ defaultKind: "io", error: Object.assign(new Error("nope"), { code: "ENOENT" }) }),
      }),
    ).toBe(false);
    expect(isTransientError({ error: typed({ defaultKind: "llm", error: new Error("claude CLI timed out") }) })).toBe(
      false,
    );
  });
});

describe("retryTransient", () => {
  it("self-heals: retries a transient failure then returns the eventual success", async () => {
    let attempts = 0;
    const value = await retryTransient({
      operation: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw httpError({ status: 500 });
        }
        return "ok";
      },
      policy: { minTimeoutMs: 0 },
    });
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("fails fast on a permanent error — one attempt, no retries", async () => {
    let attempts = 0;
    await expect(
      retryTransient({
        operation: async () => {
          attempts += 1;
          throw httpError({ status: 400 });
        },
        policy: { minTimeoutMs: 0 },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(attempts).toBe(1);
  });

  it("gives up after the retry budget on a persistent transient error", async () => {
    let attempts = 0;
    await expect(
      retryTransient({
        operation: async () => {
          attempts += 1;
          throw httpError({ status: 503 });
        },
        policy: { minTimeoutMs: 0, retries: 2 },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(attempts).toBe(3); // first attempt + 2 retries
  });
});

describe("createConcurrencyLimiter", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    const limit = createConcurrencyLimiter({ concurrency: 2 });
    const gates = [defer(), defer(), defer(), defer()];
    let running = 0;
    let peak = 0;
    const run = ({ i }: { i: number }): Promise<void> =>
      limit(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gates[i]!.promise;
        running -= 1;
      });
    const all = [run({ i: 0 }), run({ i: 1 }), run({ i: 2 }), run({ i: 3 })];
    for (const g of gates) {
      g.resolve();
    }
    await Promise.all(all);
    // Four tasks, cap of 2: the max simultaneously-running never exceeds — and reaches — 2.
    expect(peak).toBe(2);
  });
});

describe("createRateScheduler", () => {
  it("runs each scheduled task and returns its own result, in order", async () => {
    const schedule = createRateScheduler({ ratePerSec: 1000 });
    const results = await Promise.all([
      schedule(async () => "a"),
      schedule(async () => "b"),
      schedule(async () => "c"),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
  });
});

describe("withTimeout", () => {
  it("resolves with the task's own value when it settles before the deadline", async () => {
    const result = await withTimeout({ task: async () => "done", timeoutMs: 1000 });
    expect(result).toBe("done");
  });

  it("propagates the task's own rejection unchanged when it fails before the deadline", async () => {
    await expect(
      withTimeout({ task: () => Promise.reject(httpError({ status: 500 })), timeoutMs: 1000 }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("rejects with a network-coded timeout error when the task never settles", async () => {
    const stuck = new Promise<never>(() => undefined); // never resolves — the hang class this guards against
    await expect(withTimeout({ task: () => stuck, timeoutMs: 10 })).rejects.toMatchObject({ code: "ETIMEDOUT" });
  });

  it("surfaces the timeout as a retryable network error through the real classifier", async () => {
    const stuck = new Promise<never>(() => undefined);
    const error = await withTimeout({ task: () => stuck, timeoutMs: 10 }).catch((caught: unknown) => caught);
    expect(isTransientError({ error: typed({ error }) })).toBe(true);
  });
});

describe("retryDecision", () => {
  it("retries the Notion SDK's own request timeout as a network failure, not a permanent one", () => {
    // The exact class `@notionhq/client` rejects with at its 60s default: an SDK code, no status, no errno.
    const error = toIngestError({ error: new RequestTimeoutError(), operation: "notion.search", provider: "notion" });
    expect(retryDecision({ error })).toEqual({ reason: "network", retryable: true });
  });

  it("names a rate limit and carries the provider's Retry-After hint", () => {
    expect(
      retryDecision({
        error: { kind: "rate-limit", message: "slow down", operation: "slack.chat.update", retryAfterMs: 3_000 },
      }),
    ).toEqual({ reason: "rate-limit", retryAfterMs: 3_000, retryable: true });
  });

  it("treats a 429 http error as a rate limit even when the kind was not refined", () => {
    expect(retryDecision({ error: { kind: "http", message: "429", operation: "op", status: 429 } })).toEqual({
      reason: "rate-limit",
      retryable: true,
    });
  });

  it("distinguishes a network blip from a transient http status", () => {
    expect(retryDecision({ error: { kind: "network", message: "ECONNRESET", operation: "op" } })).toEqual({
      reason: "network",
      retryable: true,
    });
    expect(retryDecision({ error: { kind: "http", message: "502", operation: "op", status: 502 } })).toEqual({
      reason: "transient-http",
      retryable: true,
    });
  });

  it("refuses a 4xx, a parse failure and an io failure as permanent", () => {
    expect(retryDecision({ error: { kind: "http", message: "404", operation: "op", status: 404 } }).retryable).toBe(
      false,
    );
    expect(retryDecision({ error: { kind: "parse", message: "bad json", operation: "op" } }).retryable).toBe(false);
    expect(retryDecision({ error: { kind: "io", message: "ENOENT", operation: "op" } }).retryable).toBe(false);
  });

  it("refuses a CASSETTE REPLAY MISS ahead of every other classification", () => {
    // The cause carries Polly's stable `name`. It also carries a 429 status, which WOULD otherwise be
    // retried — so this asserts the ordering, not merely the classification.
    const cause = Object.assign(new Error("Recording for the following request is not found"), {
      name: "PollyError",
    });
    expect(retryDecision({ error: { cause, kind: "rate-limit", message: "x", operation: "op", status: 429 } })).toEqual(
      { reason: "cassette-replay-miss", retryable: false },
    );
  });
});

describe("isCassetteReplayMiss", () => {
  it("matches on Polly's stable name, not on its message wording", () => {
    const byName = Object.assign(new Error("anything at all"), { name: "PollyError" });
    expect(isCassetteReplayMiss({ error: { cause: byName, kind: "http", message: "x", operation: "op" } })).toBe(true);
    const byMessageOnly = new Error("Recording for the following request is not found");
    expect(isCassetteReplayMiss({ error: { cause: byMessageOnly, kind: "http", message: "x", operation: "op" } })).toBe(
      false,
    );
  });

  it("is false when there is no cause at all", () => {
    expect(isCassetteReplayMiss({ error: { kind: "http", message: "x", operation: "op" } })).toBe(false);
  });

  it("makes a cassette miss NON-transient, so the existing retry path refuses it too", () => {
    const cause = Object.assign(new Error("miss"), { name: "PollyError" });
    expect(isTransientError({ error: { cause, kind: "network", message: "x", operation: "op" } })).toBe(false);
  });
});

/*
 * The shipped backoff schedule, asserted WITHOUT taking a jittered draw.
 *
 * The case these replace observed one real jittered delay and checked it fell in a range — an assertion
 * whose accepted set is the entire reachable output of the code under test, so it could not fail even if
 * `randomize` flipped to false. Written exclusively it failed at random instead, on the reachable boundary
 * of 1000 ms. Resolving the tuning first makes every input to the draw exactly assertable with no clock.
 */
describe("resolvedRetryOptions", () => {
  it("resolves the SHIPPED defaults, including jitter ON — the fact a sampled draw could never establish", () => {
    expect(resolvedRetryOptions()).toEqual({
      factor: 2,
      maxTimeout: 30_000,
      minTimeout: 500,
      randomize: true,
      retries: 3,
    });
  });

  it("resolves the same defaults from an empty policy as from no policy at all", () => {
    expect(resolvedRetryOptions({})).toEqual(resolvedRetryOptions());
  });

  it("turns jitter off on request, leaving every other default standing", () => {
    expect(resolvedRetryOptions({ randomize: false })).toEqual({
      factor: 2,
      maxTimeout: 30_000,
      minTimeout: 500,
      randomize: false,
      retries: 3,
    });
  });

  it("takes an explicit ZERO base rather than reading it as absent, so a test can retry immediately", () => {
    expect(resolvedRetryOptions({ minTimeoutMs: 0 }).minTimeout).toBe(0);
  });

  it("takes an explicit ZERO retry budget rather than restoring the default three", () => {
    expect(resolvedRetryOptions({ retries: 0 }).retries).toBe(0);
  });

  it("carries a shrunk schedule through whole, which is what every fast test in the tree relies on", () => {
    expect(resolvedRetryOptions({ maxTimeoutMs: 8, minTimeoutMs: 1, randomize: false })).toEqual({
      factor: 2,
      maxTimeout: 8,
      minTimeout: 1,
      randomize: false,
      retries: 3,
    });
  });

  it("ignores the two policy fields that are not p-retry tuning, so a spread cannot smuggle them in", () => {
    const resolved = resolvedRetryOptions({ isRetryable: () => false, onRetryDelay: () => undefined });
    expect(Object.keys(resolved).toSorted()).toEqual(["factor", "maxTimeout", "minTimeout", "randomize", "retries"]);
  });
});
