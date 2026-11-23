/**
 * The per-call deadline every Notion lane races its requests against.
 *
 * Extracted from `liveApi.ts` so the WRITE lane gets the same guarantee rather than a second copy of the
 * number. A Notion call was observed hanging indefinitely during a live full-history ingest — zero CPU, zero
 * open socket, no SDK-level timeout ever firing — three separate times after a mid-crawl network blip, once
 * for over twenty minutes. The SDK's own 60s request timeout guards a slow RESPONSE; it does nothing for a
 * call stuck before that machinery engages.
 *
 * A mutation is deliberately covered too, and the consequence is stated rather than hidden: a create that
 * times out may still have landed, so the write lane reports it as INDETERMINATE and never retries it. That
 * is a better failure than a publish that hangs a visible session for twenty minutes.
 */
import { createRateScheduler, type RateScheduler, withTimeout } from "../../lib/resilience.js";

/**
 * Deadline for a single raw call, well above the SDK's own 60s request timeout so a slow-but-working request
 * is never cut off early.
 */
const NOTION_CALL_TIMEOUT_MS = 90_000;

/** Notion's documented all-tier ceiling; every lane's scheduler sits just under it. */
export const NOTION_RATE_PER_SEC = 3;

/**
 * Total attempts for a DISCOVERY call whose exhaustion loses a whole Notion lane — `search` (pages,
 * databases, reach enumeration), structure discovery and `users.list`. Every per-item call keeps the
 * door's default four, because a per-item failure already degrades to a classified skip.
 *
 * Four attempts is ~3.5–7s of backoff, and a `fetch failed` lasting longer than that threw away a whole run:
 * a `resync-corpus-notion` firing lost BOTH lanes after seventeen minutes and 801
 * committed pages, with no sleep in `pmset -g log` and the next run clean. Its sync-run record lives under
 * `$SLOPWEAVER_HOME/live/sync-runs/notion/`. Eleven attempts is ten
 * backoffs on the shipped 500ms-doubling, 30s-capped schedule (`resolvedRetryOptions`): 151.5–181s of
 * patience, the same budget Slack's fatal seam carries for its own reason (`SDK_REPLACEMENT_ATTEMPTS`).
 *
 * The bound, stated rather than hidden: each attempt races {@link NOTION_CALL_TIMEOUT_MS}, and a deadline
 * expiry is classified `network`, so eleven full hangs can hold one discovery call for ~19.5 minutes. A
 * permanent failure — a revoked token, a 404 — is not retryable and still returns on the first attempt.
 */
export const NOTION_FATAL_SEAM_ATTEMPTS = 11;

/** A rate-gated request runner that also races each call against the deadline. */
export type GatedCall = <T>(task: () => Promise<T>) => Promise<T>;

/** What races one call against its deadline — `withTimeout` in production, a plain function in a test. */
export type CallDeadline = <T>(args: { task: () => Promise<T>; timeoutMs: number }) => Promise<T>;

/**
 * Wrap a rate scheduler with the per-call deadline, so every caller gets both without repeating the wiring.
 *
 * @param scheduler the lane's own rate scheduler
 * @param deadline the racer the paced call is handed to; omitted takes the real `withTimeout`
 * @returns a runner that paces the call and then races it against {@link NOTION_CALL_TIMEOUT_MS}
 */
export function gatedCallWithDeadline({
  scheduler,
  deadline = withTimeout,
}: {
  scheduler: RateScheduler;
  deadline?: CallDeadline;
}): GatedCall {
  return (task) => scheduler(() => deadline({ task, timeoutMs: NOTION_CALL_TIMEOUT_MS }));
}

/**
 * A fresh paced-and-deadlined runner for one lane.
 *
 * @returns the runner, backed by a scheduler private to the caller
 */
export function makeNotionGatedCall(): GatedCall {
  return gatedCallWithDeadline({ scheduler: createRateScheduler({ ratePerSec: NOTION_RATE_PER_SEC }) });
}
