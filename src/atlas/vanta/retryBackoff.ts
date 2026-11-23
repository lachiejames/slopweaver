/**
 * How long the Vanta transport waits before a retry: `Retry-After` when Vanta sends a usable one, else a
 * doubling ladder whose rung depends on what failed.
 *
 * Two ladders, because two kinds of fault recover on two clocks. A 5xx or a dropped connection is transient
 * and 2s/4s/8s is enough. A 429 is the per-application 50/minute budget, shared by every process using the
 * OAuth app, so it refills over a minute and a ladder shorter than that minute fails a sync whenever another
 * Vanta verb runs beside it. MEASURED: one sync exhausted the 14-second ladder on every
 * surface Vanta rate-limited and exited 1; `slopweaver atlas vanta coverage --open-only --json` on the generation
 * that sync wrote lists each as "was rate limited and the retries were exhausted".
 */

/** The longest the transport will ever wait on Vanta's own say-so, whatever `Retry-After` asks for. */
const RETRY_AFTER_CAP_SECONDS = 60;

/** The first wait when a retryable failure that is not a 429 carries no `Retry-After`. */
const DEFAULT_BACKOFF_SECONDS = 2;

/**
 * The first wait after a 429 carrying no `Retry-After`. Doubling gives 15s, 30s, 60s — retries about 15s, 45s
 * and 105s after the first refusal, so the last one lands in a fresh one-minute window whatever shape
 * Vanta's quota window has, while an interactive caller can still recover at 15s when capacity frees early.
 */
const RATE_LIMIT_BACKOFF_SECONDS = 15;

/**
 * Read a header case-insensitively over a plain record; a response that did not send it has none, by design.
 *
 * @param name the header, lowercase
 * @returns the header's value, or `null` when it was not sent
 */
export function headerValue({
  headers,
  name,
}: {
  headers: Readonly<Record<string, string>>;
  name: string;
}): string | null {
  const direct = headers[name];
  if (direct !== undefined) {
    return direct;
  }
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  if (match === undefined) {
    return null;
  }
  return match[1];
}

/**
 * Seconds to wait before retrying, preferring `Retry-After` over the fixed backoff, capped either way. A 429
 * without one backs off from {@link RATE_LIMIT_BACKOFF_SECONDS}; every other retryable fault from
 * {@link DEFAULT_BACKOFF_SECONDS}.
 *
 * @param headers the failing response's headers, empty when none arrived
 * @param attempt zero-based index of the attempt that just failed
 * @param status the response's HTTP status, or `null` when no response arrived at all
 * @returns whole seconds to sleep before the next attempt
 */
export function retryWaitSeconds({
  headers,
  attempt,
  status,
}: {
  headers: Readonly<Record<string, string>>;
  attempt: number;
  status: number | null;
}): number {
  const retryAfter = headerValue({ headers, name: "retry-after" });
  // Delay-seconds only, whole: `parseInt` would read "5garbage" as 5 and let a malformed header override a
  // 429's own backoff. An HTTP-date is not read either, and takes the fallback as it always did.
  if (retryAfter !== null && /^\s*\d+\s*$/.test(retryAfter)) {
    return Math.min(Number.parseInt(retryAfter, 10), RETRY_AFTER_CAP_SECONDS);
  }
  let base = DEFAULT_BACKOFF_SECONDS;
  if (status === 429) {
    base = RATE_LIMIT_BACKOFF_SECONDS;
  }
  return Math.min(base * 2 ** attempt, RETRY_AFTER_CAP_SECONDS);
}
