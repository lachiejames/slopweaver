/**
 * The resilience layer: thin, injectable seams over battle-tested libraries — replacing the repo's
 * former hand-rolled retry/backoff loop and its rate limiter (D21). The ONE piece we keep ourselves is
 * the pure, API-agnostic transient-error classification ({@link isTransientError}); every timing,
 * backoff, jitter, pacing, and concurrency loop is now delegated to a maintained ESM library:
 *
 * - **retry + backoff + jitter** → `p-retry` (via {@link retryTransient})
 * - **bounded local concurrency** → `p-limit` (via {@link createConcurrencyLimiter})
 * - **in-process API rate pacing** → `p-throttle` (via {@link createRateScheduler})
 *
 * GitHub keeps its own `@octokit/plugin-retry` + `plugin-throttling` (already settled — see STACK.md);
 * these seams cover the Slack/Linear/Notion SDKs and the on-device embed fan-out. Nothing here needs
 * external infra, and no bespoke backoff, rate limiter, or worker pool survives.
 *
 * PR3.6 re-evaluated `rate-limiter-flexible` (the archive's outbound limiter) and REJECTED it: its value is
 * a Redis-backed limiter shared across a distributed service — Slopweaver is a zero-infra single-process
 * CLI, so `p-throttle` (strict per-crawl pacing) + `p-limit` already cover the need. The retry CLASSIFIER,
 * though, moved onto the typed {@link ./ingestError.IngestError} (see {@link isTransientError}).
 */
import pLimit from "p-limit";
import pRetry from "p-retry";
import pThrottle from "p-throttle";
import pTimeout from "p-timeout";

import { hasTransientStatus, type IngestError, toIngestError } from "./ingestError.js";

/**
 * Is this typed error worth retrying? Classifies the TYPED {@link IngestError} — not a raw thrown shape —
 * so the status/code/kind detail that {@link toIngestError} preserved drives the decision (PR3.6 killed
 * the old lossy boolean that re-sniffed an `unknown`). A `rate-limit` or `network` kind, or an `http`
 * kind with a transient status (429/5xx), is retryable; every other kind (`parse`/`io`/`llm`, or a 4xx
 * `http`) is permanent and fails fast. Pure — no timing, so a test asserts the classification exactly.
 *
 * @param error the typed boundary error
 * @returns true when a retry could plausibly clear the failure
 */
export function isTransientError({ error }: { error: IngestError }): boolean {
  // A cassette miss is checked FIRST and unconditionally, ahead of every other classification. See
  // `isCassetteReplayMiss` for why retrying one is uniquely destructive.
  if (isCassetteReplayMiss({ error })) {
    return false;
  }
  if (error.kind === "rate-limit" || error.kind === "network") {
    return true;
  }
  if (error.kind === "http") {
    return hasTransientStatus({ error });
  }
  return false;
}

/**
 * Whether this failure is a Polly REPLAY MISS — the cassette has no recording for a request a test just
 * made — rather than anything the provider did.
 *
 * Retrying one is uniquely destructive and worth spelling out: the recording will never appear, so every
 * attempt fails identically, and with backoff a single missing entry burns the whole test run's time
 * budget before reporting a failure that was obvious on the first attempt. The prior system hit this and
 * hard-coded the same refusal; it is taken here deliberately rather than rediscovered.
 *
 * Classified on the error's `name`, which is Polly's stable public surface, NOT on its message. A message
 * match would be a lint-shaped trap: it silently stops matching the day the wording changes, and the
 * symptom is a test suite that hangs instead of failing.
 *
 * @param error the typed boundary failure, whose `cause` holds the original thrown value verbatim
 * @returns true when the failure is a missing cassette entry
 */
export function isCassetteReplayMiss({ error }: { error: IngestError }): boolean {
  const cause: unknown = error.cause;
  return typeof cause === "object" && cause !== null && "name" in cause && cause.name === "PollyError";
}

/**
 * Why shared retry will or will not try again, as one value.
 *
 * The point of returning a `reason` rather than a bare boolean is that the three retryable cases want
 * different WAITS: a rate limit says when to come back, a network blip wants ordinary backoff. The prior
 * system classified retryability by matching error strings, was rewritten, and still ended up with three
 * separate retry entry points because some SDKs throw and others return a value. Here the platform error
 * has already been normalised into {@link IngestError} at the boundary, so this decision never sees an SDK
 * type — which is the property that keeps one retry path honest across four providers.
 */
export type RetryDecision =
  | { readonly retryable: true; readonly reason: "rate-limit"; readonly retryAfterMs?: number | undefined }
  | { readonly retryable: true; readonly reason: "network" | "transient-http" }
  | { readonly retryable: false; readonly reason: "cassette-replay-miss" | "permanent" };

/**
 * Decide whether and why to retry a typed boundary failure. Pure.
 *
 * @param error the typed boundary failure
 * @returns the decision, carrying a `Retry-After` hint when the provider supplied one
 */
export function retryDecision({ error }: { error: IngestError }): RetryDecision {
  if (isCassetteReplayMiss({ error })) {
    return { reason: "cassette-replay-miss", retryable: false };
  }
  if (error.kind === "rate-limit" || (error.kind === "http" && error.status === 429)) {
    return {
      reason: "rate-limit",
      retryable: true,
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    };
  }
  if (error.kind === "network") {
    return { reason: "network", retryable: true };
  }
  if (error.kind === "http" && hasTransientStatus({ error })) {
    return { reason: "transient-http", retryable: true };
  }
  return { reason: "permanent", retryable: false };
}

/** Tuning for {@link retryTransient} — all optional; the defaults suit an API backfill. */
export interface RetryPolicy {
  /** Retries AFTER the first attempt (defaults to 3 ⇒ 4 total tries). */
  readonly retries?: number;
  /** First backoff delay in ms; grows by `factor` each retry (defaults to 500). `0` ⇒ retry immediately. */
  readonly minTimeoutMs?: number;
  /** Backoff ceiling in ms (defaults to 30s). */
  readonly maxTimeoutMs?: number;
  /** Override the transient classification (defaults to {@link isTransientError}). */
  readonly isRetryable?: (error: unknown) => boolean;
  /**
   * Jitter each backoff (defaults to true). A test sets `false` so the schedule is exact and assertable.
   *
   * Jitter WIDENS each delay to the CLOSED range `[base, 2 × base]`, and the upper bound is attainable
   * rather than merely approached — see {@link resolvedRetryOptions} for the derivation and for the
   * boundary this field's own range once cost a CI lane.
   */
  readonly randomize?: boolean;
  /**
   * Observe each backoff the library is ABOUT to take, before it takes it.
   *
   * `p-retry` owns both the delay computation and the sleep, and accepts no injected sleeper — so this is
   * the seam that makes the schedule assertable at all. A test pairs it with a `minTimeoutMs` small enough
   * that the real wait is noise, then asserts the exact delays that were requested. Without it, a missing
   * backoff is invisible to a suite that only counts attempts, which is precisely how PR5.2 shipped a
   * `safeProviderCall` retry loop with no spacing between attempts.
   */
  readonly onRetryDelay?: (args: { readonly attempt: number; readonly delayMs: number }) => void;
}

/**
 * The shipped retry schedule, in ONE place: every tuning default {@link retryTransient} hands `p-retry`.
 *
 * ## Why this is a function rather than four `??`s at the call site
 *
 * The numbers used to be inline defaults inside `retryTransient`, which made them unassertable without
 * running the driver and sampling a real jittered draw — and a sampled assertion is how the boundary below
 * reddened unrelated pull requests. Resolved here, production reads exactly what a zero-I/O unit test reads,
 * so "jitter is on by default" is a deterministic fact rather than something a test hopes to observe. It
 * also spells them as destructured defaults, which is the shape `no-silent-fallback` asks for.
 *
 * ## The jitter range, and why its upper bound is CLOSED
 *
 * `p-retry@8.0.1` computes each delay as
 * `Math.round((Math.random() + 1) * minTimeout * factor ** n)`, clamped to `maxTimeout`
 * (`node_modules/p-retry/index.js:66-71`). With the defaults below the first retry therefore spans the
 * **closed** integer range `[500, 1000]` ms and the nth `[500·2ⁿ, 1000·2ⁿ]` — `1000` is REACHABLE, from any
 * draw of `0.999` or above, not merely approached. An exclusive `toBeLessThan(1_000)` written against it
 * failed CI run 35246992026 with "expected 1000 to be less than 1000" on a diff that touched neither this
 * file nor its caller; the first measured occurrence was run 32624025722. Re-read the formula after a bump:
 *
 * ```bash
 * sed -n '66,71p' node_modules/p-retry/index.js
 * ```
 *
 * The DRAW itself stays unassertable, and that is a property of the library rather than an omission here:
 * `Math.random()` is called inline at line 68, `Options` exposes no random seam and no injectable sleeper,
 * and this repo bans `vi.spyOn`. What is assertable — and is asserted — is every input the draw is taken
 * over.
 *
 * @returns the complete `p-retry` tuning set, every field present so a spread cannot trip
 *   `exactOptionalPropertyTypes`
 */
export function resolvedRetryOptions({
  minTimeoutMs = 500,
  maxTimeoutMs = 30_000,
  randomize = true,
  retries = 3,
}: RetryPolicy = {}): {
  readonly factor: number;
  readonly maxTimeout: number;
  readonly minTimeout: number;
  readonly randomize: boolean;
  readonly retries: number;
} {
  return { factor: 2, maxTimeout: maxTimeoutMs, minTimeout: minTimeoutMs, randomize, retries };
}

/**
 * Run `operation`, retrying only a transient failure with exponential backoff + jitter (via `p-retry`),
 * then rejecting with the last error. A permanent failure rejects on the first attempt.
 *
 * The spacing is whatever {@link resolvedRetryOptions} resolves — 500 ms, doubling, capped at 30 s, and
 * jittered, so the first retry lands anywhere in the CLOSED range `[500, 1000]` ms. That function's doc
 * carries the derivation; do not restate the formula at a call site.
 *
 * @param operation the async call to run + retry
 * @param policy retry tuning + classification override (tests pass `minTimeoutMs: 0` to avoid waiting)
 * @returns the operation's result
 */
export async function retryTransient<T>({
  operation,
  policy = {},
}: {
  operation: () => Promise<T>;
  policy?: RetryPolicy;
}): Promise<T> {
  // p-retry retries THROWS internally; the default classifier maps each thrown value to a typed error
  // first, so the retry decision runs over the same typed classification the safe wrappers produce.
  // A destructured default, not an annotated arrow: the arrow inherits `RetryPolicy["isRetryable"]`'s shape
  // instead of restating it, so the compiler — not a reader — checks that it still matches the contract.
  const {
    isRetryable = (error) => isTransientError({ error: toIngestError({ error, operation: "retryTransient" }) }),
  } = policy;
  return pRetry(operation, {
    ...resolvedRetryOptions(policy),
    onFailedAttempt: ({ attemptNumber, retryDelay }) => {
      // Only a wait that is actually about to happen is reported. `p-retry` calls this on the FINAL failure
      // too, where `retryDelay` is 0 because nothing more will be tried — reporting that as a delay would
      // make an observer's record disagree with the sleeps taken.
      if (retryDelay > 0) {
        policy.onRetryDelay?.({ attempt: attemptNumber, delayMs: retryDelay });
      }
    },
    shouldRetry: ({ error }) => isRetryable(error),
  });
}

/** Runs a task under a shared concurrency cap; returns the task's own result. */
export type ConcurrencyLimiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * A bounded-concurrency runner (via `p-limit`): at most `concurrency` tasks run at once, the rest queue.
 * Construct ONE and share it across a fan-out so the ceiling is global.
 *
 * @param concurrency the maximum number of tasks allowed to run simultaneously
 * @returns a runner that schedules a task under the shared cap
 */
export function createConcurrencyLimiter({ concurrency }: { concurrency: number }): ConcurrencyLimiter {
  const limit = pLimit(concurrency);
  return (task) => limit(task);
}

/** Runs a task under a shared rate gate; returns the task's own result. */
export type RateScheduler = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * An in-process rate gate (via `p-throttle`, strict mode): calls are spaced so no more than `ratePerSec`
 * run per second, evenly. Construct ONE per crawl and route every request through it so a big recursive
 * fan-out never self-429s. No external infra.
 *
 * @param ratePerSec the sustained requests-per-second ceiling
 * @returns a scheduler that paces a task under the shared rate
 */
export function createRateScheduler({ ratePerSec }: { ratePerSec: number }): RateScheduler {
  const interval = Math.max(1, Math.round(1000 / ratePerSec));
  const throttle = pThrottle({ interval, limit: 1, strict: true });
  // One shared throttled runner: p-throttle paces the calls to `run`; each invocation just executes the
  // task. The caller's own return type is carried by the RateScheduler generic (the runner is `unknown`),
  // so the assertion sits ONCE at the library boundary rather than inside a wrapper on every call.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return throttle((task: () => Promise<unknown>) => task()) as RateScheduler;
}

/**
 * Race a task against a hard deadline, so a call that never settles at all — no CPU, no open socket,
 * observed in practice after a VPN blip during a long Notion crawl — still surfaces as a failure a caller
 * can retry, instead of blocking it forever. A provider SDK's own request timeout guards a slow RESPONSE;
 * it does nothing for a call stuck before that machinery ever engages.
 *
 * The timeout is thrown carrying `code: "ETIMEDOUT"`, the same shape a real dropped connection already
 * has, so `IngestError`'s existing network classification retries it without a second retry path.
 * `p-timeout` owns the actual race and timer cleanup — no bespoke `Promise.race`, matching this file's own
 * "no hand-rolled timing" rule.
 *
 * @param task the operation to race
 * @param timeoutMs the deadline in ms
 * @returns the task's value, or rejects with a network-classified timeout error
 */
export async function withTimeout<T>({ task, timeoutMs }: { task: () => Promise<T>; timeoutMs: number }): Promise<T> {
  return pTimeout(task(), {
    message: Object.assign(new Error(`stuck call: no response after ${String(timeoutMs)}ms`), {
      code: "ETIMEDOUT",
    }),
    milliseconds: timeoutMs,
  });
}
