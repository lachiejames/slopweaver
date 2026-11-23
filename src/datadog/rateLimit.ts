/**
 * Datadog's rate-limit headers, read rather than guessed at.
 *
 * ## This module does NOT retry, and that is the point
 *
 * The SDK's HTTP layer already owns the retry loop, and its `calculateRetryInterval` prefers
 * `x-ratelimit-reset` over its exponential ladder, which is exactly the correct behaviour. Writing a second
 * retry loop here would be a second policy that disagrees with the first while the first still runs
 * underneath whatever this one decided.
 *
 * So the division is: **the SDK waits, this module explains.** What it owns is (a) the two configuration
 * values that turn the SDK's loop on, because it is OFF by default, and (b) a pure reading of the headers
 * so a verb can say "waited 9s on logs_public_analytics_aggregate" instead of appearing to hang.
 *
 * ## What a live account measures
 *
 * Datadog's aggregate endpoints are tightly rate-limited — a logs analytics aggregate has been observed
 * allowing as few as 2 requests per 10 seconds, with the third returning a real 429 carrying:
 *
 * ```text
 * x-ratelimit-limit: 2   x-ratelimit-period: 10   x-ratelimit-remaining: 0
 * x-ratelimit-reset: 9   x-ratelimit-name: logs_public_analytics_aggregate
 * ```
 *
 * **A 429 from Datadog carries no `retry-after` header.** `x-ratelimit-reset` is the only wait signal,
 * which is why the SDK's preference for it is load-bearing rather than incidental: with that header
 * missing the loop would fall back to a 2-second first retry into a window that has 9 seconds left, burn
 * an attempt, and report a rate limit as a hard failure.
 */

import { absentAsNull } from "#lib/absent.js";

/** Header names Datadog sets on every metered response. Lower-cased; lookup is case-insensitive. */
const HEADERS = {
  limit: "x-ratelimit-limit",
  period: "x-ratelimit-period",
  remaining: "x-ratelimit-remaining",
  reset: "x-ratelimit-reset",
  name: "x-ratelimit-name",
} as const;

/**
 * How many times the SDK may retry one request.
 *
 * Three, against a 10-second window: a single 429 costs one retry, and a burst that loses three windows
 * in a row is a caller doing something this CLI should not be doing quietly. The SDK's `maxRetries`
 * default is also 3, so this restates it deliberately rather than inheriting it — the value is a decision
 * about how long a verb may block, and an SDK upgrade changing it silently would change that.
 */
export const RATE_LIMIT_MAX_RETRIES = 3;

/**
 * Seconds the SDK waits when a 429 arrives with no `x-ratelimit-reset` to read.
 *
 * Only reachable on a 5xx or a malformed 429; a real Datadog rate limit always carries the header. The
 * SDK requires a base of at least 2 and throws below it, so this is both the floor and the observed
 * minimum useful wait.
 */
export const RATE_LIMIT_BACKOFF_BASE_SECONDS = 2;

/** What a metered response said about the caller's budget. Every field is `null` when absent or unparseable. */
export interface RateLimitSnapshot {
  /** Requests allowed per {@link RateLimitSnapshot.period}. */
  readonly limit: number | null;
  /** Length of the limit window, in seconds. */
  readonly period: number | null;
  /** Requests left in the current window. `0` is the interesting value. */
  readonly remaining: number | null;
  /** Seconds until the window resets — the ONLY wait signal Datadog sends. See the file header. */
  readonly resetSeconds: number | null;
  /** Datadog's name for the limit, e.g. `logs_public_analytics_aggregate`. */
  readonly name: string | null;
}

/**
 * Case-insensitive header lookup over a plain record.
 *
 * Node's `fetch` lower-cases header names and the SDK copies them verbatim, so a direct read would work
 * today. It is done properly anyway because the cost is one line and the failure mode is silent: a header
 * read as absent grades an unknown budget as "unmetered", which is the wrong default to be wrong about.
 *
 * @param headers the response headers
 * @param name the header to find, lower-cased
 * @returns the value, or `null` when the header is absent
 */
function headerValue({ headers, name }: { headers: Readonly<Record<string, string>>; name: string }): string | null {
  const direct = headers[name];
  if (direct !== undefined) {
    return direct;
  }
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return absentAsNull({ value: match?.[1] });
}

/**
 * Parse a header to a non-negative integer, or `null`.
 *
 * Strict rather than `parseInt`: `parseInt('9abc')` is `9`, and a header that is not a clean integer means
 * an assumption about this API has broken. Reporting that as `null` — budget unknown — is honest, where
 * silently accepting a prefix is how a wrong number becomes a wrong decision.
 *
 * @param raw the header value, or `null`
 * @returns the integer, or `null` when absent or not a clean non-negative integer
 */
function integerOrNull({ raw }: { raw: string | null }): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  return Number.parseInt(raw.trim(), 10);
}

/**
 * Read Datadog's rate-limit headers off a response.
 *
 * @param headers the response headers
 * @returns the budget, or `null` when the response carried no rate-limit headers at all (an unmetered
 *   endpoint, which is why an unmetered call makes a good preflight)
 */
export function parseRateLimit({ headers }: { headers: Readonly<Record<string, string>> }): RateLimitSnapshot | null {
  const snapshot: RateLimitSnapshot = {
    limit: integerOrNull({ raw: headerValue({ headers, name: HEADERS.limit }) }),
    period: integerOrNull({ raw: headerValue({ headers, name: HEADERS.period }) }),
    remaining: integerOrNull({ raw: headerValue({ headers, name: HEADERS.remaining }) }),
    resetSeconds: integerOrNull({ raw: headerValue({ headers, name: HEADERS.reset }) }),
    name: headerValue({ headers, name: HEADERS.name }),
  };
  const metered = Object.values(snapshot).some((field) => field !== null);
  return metered ? snapshot : null;
}

/**
 * Describe a rate-limit budget in one line, for a diagnostic.
 *
 * @param snapshot the parsed budget
 * @returns a line naming the limit and what is left of it
 */
export function describeRateLimit({ snapshot }: { snapshot: RateLimitSnapshot }): string {
  const name = describedLimit({ name: snapshot.name });
  const budget =
    snapshot.limit === null || snapshot.period === null
      ? "budget unknown"
      : `${String(snapshot.limit)} per ${String(snapshot.period)}s`;
  const remaining = snapshot.remaining === null ? "remaining unknown" : `${String(snapshot.remaining)} left`;
  const reset = snapshot.resetSeconds === null ? "no reset signal" : `resets in ${String(snapshot.resetSeconds)}s`;
  return `${name}: ${budget}, ${remaining}, ${reset}`;
}

/**
 * The line to emit when a request was rate-limited, naming the wait the SDK is about to take.
 *
 * Separate from {@link describeRateLimit} because the audiences differ: this one is a warning a user needs
 * while a verb appears to hang, and it must say the number of seconds even when the header was missing —
 * "waiting, length unknown" is still better than silence.
 *
 * @param snapshot the parsed budget, or `null` when the 429 carried no headers
 * @returns the warning line
 */
export function describeRateLimitWait({ snapshot }: { snapshot: RateLimitSnapshot | null }): string {
  if (snapshot === null) {
    return `Datadog rate-limited this request and sent no rate-limit headers; retrying after ${String(RATE_LIMIT_BACKOFF_BASE_SECONDS)}s`;
  }
  const wait = announcedWait({ resetSeconds: snapshot.resetSeconds });
  const name = waitedOnLimit({ name: snapshot.name });
  return `Datadog rate-limited this request on ${name}; waiting ${String(wait)}s for the window to reset`;
}

/**
 * The limit a budget diagnostic names.
 *
 * Datadog sends `x-ratelimit-name` beside its other metering headers, but a snapshot is built from whichever
 * of them arrived, so a partial set — a 5xx, a malformed 429 — reads with no name, and the line says so.
 */
function describedLimit({ name }: { name: string | null }): string {
  if (name === null) {
    return "unnamed limit";
  }
  return name;
}

/**
 * The limit a wait warning names, after "on" — the same partial-header absence {@link describedLimit} reads.
 */
function waitedOnLimit({ name }: { name: string | null }): string {
  if (name === null) {
    return "an unnamed limit";
  }
  return name;
}

/**
 * The seconds a 429's retry is about to wait.
 *
 * `x-ratelimit-reset` is Datadog's only wait signal, and a 429 lacking it (a malformed one; a real limit always
 * carries it) is retried after {@link RATE_LIMIT_BACKOFF_BASE_SECONDS}, so that is the wait the warning names.
 */
function announcedWait({ resetSeconds }: { resetSeconds: number | null }): number {
  if (resetSeconds === null) {
    return RATE_LIMIT_BACKOFF_BASE_SECONDS;
  }
  return resetSeconds;
}
